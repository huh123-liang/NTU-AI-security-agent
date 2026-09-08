#!/usr/bin/env python3
"""Local-only discovery and normalization for ZIP bundles of CSV/CSV.GZ files."""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import re
import shutil
import sqlite3
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, date
from pathlib import Path


CANONICAL_FIELDS = [
    "ignore", "patient_id", "encounter_id", "visit_date", "age", "sex", "ethnicity",
    "diagnosis_code", "diagnosis_display", "observation_name", "observation_value", "observation_unit",
    "systolic_bp", "diastolic_bp", "hba1c", "egfr", "ldl", "weight", "height", "bmi",
]

FIELD_ALIASES = {
    "patient_id": ("patientid", "patient_id", "subjectid", "subject_id", "personid", "person_id", "mrn", "patid"),
    "encounter_id": ("encounterid", "encounter_id", "visitid", "visit_id", "hadmid", "hadm_id", "admissionid", "admission_id"),
    "visit_date": ("visitdate", "visit_date", "chartdate", "chart_date", "encounterdate", "encounter_date", "admittime", "admit_time", "date", "datetime", "timestamp"),
    "age": ("age", "anchor_age", "ageyears", "age_years"),
    "sex": ("sex", "gender", "administrativegender", "administrative_gender"),
    "ethnicity": ("ethnicity", "race", "raceethnicity", "race_ethnicity"),
    "diagnosis_code": ("diagnosiscode", "diagnosis_code", "icdcode", "icd_code", "dxcode", "dx_code", "code"),
    "diagnosis_display": ("diagnosisdisplay", "diagnosis_display", "diagnosis", "condition", "longtitle", "long_title", "description"),
    "observation_name": ("observationname", "observation_name", "resultname", "result_name", "testname", "test_name", "measurement", "parameter"),
    "observation_value": ("observationvalue", "observation_value", "resultvalue", "result_value", "value", "valuenum", "numericvalue", "numeric_value"),
    "observation_unit": ("observationunit", "observation_unit", "resultunit", "result_unit", "unit", "valueuom", "value_uom"),
    "systolic_bp": ("sbp", "systolic", "systolicbp", "systolic_bp", "systolicbloodpressure"),
    "diastolic_bp": ("dbp", "diastolic", "diastolicbp", "diastolic_bp", "diastolicbloodpressure"),
    "hba1c": ("hba1c", "a1c", "hemoglobina1c", "glycatedhemoglobin"),
    "egfr": ("egfr", "estimatedgfr", "estimated_glomerular_filtration_rate"),
    "ldl": ("ldl", "ldlc", "ldl_c", "ldlcholesterol"),
    "weight": ("weight", "bodyweight", "body_weight"),
    "height": ("height", "bodyheight", "body_height"),
    "bmi": ("bmi", "bodymassindex", "body_mass_index"),
}

DISPLAY = {
    "systolic_bp": "Systolic blood pressure", "diastolic_bp": "Diastolic blood pressure",
    "hba1c": "HbA1c", "egfr": "eGFR", "ldl": "LDL cholesterol",
    "weight": "Weight", "height": "Height", "bmi": "BMI",
}

UNITS = {
    "systolic_bp": "mmHg", "diastolic_bp": "mmHg", "hba1c": "%",
    "egfr": "mL/min/1.73m²", "ldl": "mmol/L", "weight": "kg", "height": "cm", "bmi": "kg/m²",
}

RANGES = {
    "systolic_bp": (60, 260), "diastolic_bp": (30, 160), "hba1c": (2, 25),
    "egfr": (1, 200), "ldl": (0, 20), "weight": (20, 400), "height": (100, 250), "bmi": (10, 80),
}


def emit(stage: str, progress: int, message: str, **details):
    print(json.dumps({"stage": stage, "progress": progress, "message": message, "details": details}, ensure_ascii=False), flush=True)


def file_sha256(path: Path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def open_entry(archive: zipfile.ZipFile, entry: str, encoding: str = "utf-8-sig"):
    raw = archive.open(entry)
    binary = gzip.GzipFile(fileobj=raw) if entry.lower().endswith(".gz") else raw
    return io.TextIOWrapper(binary, encoding=encoding, errors="replace", newline="")


def detect_encoding_and_dialect(archive: zipfile.ZipFile, entry: str):
    if entry.lower().endswith(".gz"):
        with archive.open(entry) as source, gzip.GzipFile(fileobj=source) as stream:
            raw = stream.read(131072)
    else:
        with archive.open(entry) as source:
            raw = source.read(131072)
    encoding = "utf-8-sig"
    for candidate in ("utf-8-sig", "gb18030", "latin-1"):
        try:
            sample = raw.decode(candidate)
            encoding = candidate
            break
        except UnicodeDecodeError:
            continue
    try:
        dialect = csv.Sniffer().sniff(sample[:32768], delimiters=",\t;|")
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ","
    return encoding, delimiter


def field_suggestion(name: str, samples: list[str]):
    normalized = norm(name)
    for canonical, aliases in FIELD_ALIASES.items():
        if normalized in {norm(item) for item in aliases}:
            return canonical, 0.98, "Recognised field name"
    joined = " ".join(str(item).lower() for item in samples if item)
    if normalized.endswith("id") and len(set(samples)) >= max(2, len(samples) * 0.7):
        return "patient_id", 0.55, "ID-like field; confirmation required"
    if "date" in normalized or "time" in normalized:
        return "visit_date", 0.62, "Date-like field name; confirmation required"
    if re.search(r"\b(male|female|m|f)\b", joined):
        return "sex", 0.62, "Values resemble biological sex categories"
    return "ignore", 0.0, "No safe automatic mapping"


def infer_role(field_map: dict[str, str]):
    values = set(field_map.values())
    if "diagnosis_code" in values and "patient_id" not in values and "diagnosis_display" in values:
        return "dictionary"
    if "diagnosis_code" in values and ("patient_id" in values or "encounter_id" in values):
        return "diagnosis"
    if "observation_name" in values or "observation_value" in values or values.intersection(DISPLAY):
        return "observation"
    if "encounter_id" in values and "visit_date" in values:
        return "encounter"
    if "patient_id" in values and values.intersection({"age", "sex", "ethnicity"}):
        return "patient"
    return "mixed"


def inspect_archive(source: Path, output: Path):
    tables = []
    structure = []
    with zipfile.ZipFile(source) as archive:
        entries = [item.filename for item in archive.infolist() if not item.is_dir() and item.filename.lower().endswith((".csv", ".csv.gz"))]
        if not entries:
            raise ValueError("ZIP contains no CSV or CSV.GZ tables.")
        for index, entry in enumerate(entries):
            encoding, delimiter = detect_encoding_and_dialect(archive, entry)
            with open_entry(archive, entry, encoding) as stream:
                reader = csv.DictReader(stream, delimiter=delimiter)
                fields = list(reader.fieldnames or [])
                samples = defaultdict(list)
                rows = 0
                for row in reader:
                    rows += 1
                    for field in fields:
                        if len(samples[field]) < 40 and str(row.get(field, "")).strip():
                            samples[field].append(str(row[field]).strip())
                    if rows >= 500:
                        break
            suggested = {}
            profiles = []
            for field in fields:
                canonical, confidence, reason = field_suggestion(field, samples[field])
                suggested[field] = canonical
                values = samples[field]
                profiles.append({
                    "name": field, "suggested": canonical, "confidence": confidence, "reason": reason,
                    "sample": values[:3], "sampleNonEmpty": len(values), "sampleUnique": len(set(values)),
                })
            role = infer_role(suggested)
            table = {
                "entry": entry, "compressedSize": archive.getinfo(entry).compress_size,
                "uncompressedSize": archive.getinfo(entry).file_size, "encoding": encoding,
                "delimiter": delimiter, "sampleRows": rows, "role": role, "fields": profiles,
            }
            tables.append(table)
            structure.append({"entry": entry, "headers": fields})
            emit("inspecting", 5 + round((index + 1) / len(entries) * 85), f"Inspected {entry}")
    fingerprint = hashlib.sha256(json.dumps(structure, sort_keys=True).encode()).hexdigest()
    mapping = {"version": "hospital-csv-mapping-v1", "tables": [
        {"entry": table["entry"], "role": table["role"], "encoding": table["encoding"],
         "delimiter": table["delimiter"], "fields": {field["name"]: field["suggested"] for field in table["fields"]}}
        for table in tables
    ]}
    result = {"format": "hospital-csv-zip", "tableCount": len(tables), "tables": tables,
              "structureFingerprint": fingerprint, "suggestedMapping": mapping, "canonicalFields": CANONICAL_FIELDS}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    emit("awaiting_mapping", 100, "Schema discovery completed", tables=len(tables), fingerprint=fingerprint)


def parse_date(value: str):
    text = str(value or "").strip().replace("Z", "+00:00")
    if not text:
        return None
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%b-%Y", "%Y%m%d"):
        try:
            return datetime.strptime(text[:20], fmt).date()
        except ValueError:
            continue
    return None


def numeric(value):
    match = re.search(r"[-+]?\d+(?:\.\d+)?", str(value or "").replace(",", ""))
    return float(match.group()) if match else None


def chronic_condition(code: str, display: str):
    c = re.sub(r"[^A-Z0-9]", "", str(code or "").upper())
    text = str(display or "").lower()
    groups = [
        ("diabetes", "Diabetes mellitus", c.startswith(("250", "E08", "E09", "E10", "E11", "E12", "E13")) or "diabet" in text),
        ("hypertension", "Hypertension", c.startswith(("401", "402", "403", "404", "405", "I10", "I11", "I12", "I13", "I15")) or "hypertens" in text),
        ("ckd", "Chronic kidney disease", c.startswith(("585", "N18")) or "chronic kidney" in text),
        ("hyperlipidaemia", "Hyperlipidaemia", c.startswith(("272", "E78")) or any(word in text for word in ("hyperlip", "hyperchol", "dyslip"))),
    ]
    return next(((key, label) for key, label, matched in groups if matched), None)


def mapped(row: dict, fields: dict):
    result = {}
    for source, canonical in fields.items():
        if canonical and canonical != "ignore" and source in row:
            result[canonical] = str(row.get(source, "")).strip()
            result[f"__source_{canonical}"] = source
    return result


def normalize_metric(kind: str, value, unit: str):
    number = numeric(value)
    if number is None:
        return None
    raw_unit = str(unit or "").strip()
    lowered = raw_unit.lower().replace(" ", "")
    converted = False
    formula = None
    if kind == "weight" and lowered in {"lb", "lbs", "pound", "pounds"}:
        number *= 0.45359237; converted = True; formula = "lb × 0.45359237"
    elif kind == "height" and lowered in {"in", "inch", "inches"}:
        number *= 2.54; converted = True; formula = "in × 2.54"
    elif kind == "ldl" and lowered in {"mg/dl", "mgdl"}:
        number /= 38.67; converted = True; formula = "mg/dL ÷ 38.67"
    elif kind == "hba1c" and lowered in {"mmol/mol", "mmolmol"}:
        number = number / 10.929 + 2.15; converted = True; formula = "mmol/mol ÷ 10.929 + 2.15"
    low, high = RANGES[kind]
    if not low <= number <= high:
        return None
    return round(number, 3), UNITS[kind], {"converted": converted, "originalValue": value, "originalUnit": raw_unit, "formula": formula}


def observation_metrics(name: str, value: str, unit: str):
    label = norm(name)
    if "bloodpressure" in label or label in {"bp", "nibp"}:
        match = re.search(r"(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)", str(value))
        if match:
            return [("systolic_bp", match.group(1), "mmHg"), ("diastolic_bp", match.group(2), "mmHg")]
    for kind, aliases in {
        "hba1c": ("hba1c", "hemoglobina1c", "a1c"), "egfr": ("egfr", "estimatedgfr"),
        "ldl": ("ldl", "ldlc", "ldlcholesterol"), "weight": ("weight", "bodyweight"),
        "height": ("height", "bodyheight"), "bmi": ("bmi", "bodymassindex"),
        "systolic_bp": ("systolic", "systolicbp"), "diastolic_bp": ("diastolic", "diastolicbp"),
    }.items():
        if any(alias in label for alias in aliases):
            return [(kind, value, unit)]
    return []


def setup_staging(path: Path):
    if path.exists():
        path.unlink()
    db = sqlite3.connect(path)
    db.executescript("""
      PRAGMA journal_mode=WAL;
      CREATE TABLE patients(pid TEXT PRIMARY KEY, age TEXT, sex TEXT, ethnicity TEXT);
      CREATE TABLE encounters(encounter_id TEXT PRIMARY KEY, pid TEXT, visit_date TEXT);
      CREATE TABLE code_dictionary(code TEXT PRIMARY KEY, display TEXT);
      CREATE TABLE conditions(pid TEXT, code TEXT, display TEXT, source_file TEXT, source_row INTEGER);
      CREATE TABLE events(pid TEXT, visit_date TEXT, kind TEXT, value REAL, unit TEXT, source_file TEXT, source_row INTEGER, source_column TEXT, transform_json TEXT);
      CREATE INDEX idx_events_patient_date ON events(pid, visit_date);
      CREATE INDEX idx_conditions_patient ON conditions(pid);
      CREATE INDEX idx_encounters_patient ON encounters(pid);
    """)
    return db


def process_archive(source: Path, mapping_path: Path, output_dir: Path):
    mapping = json.loads(mapping_path.read_text(encoding="utf-8"))
    output_dir.mkdir(parents=True, exist_ok=True)
    patient_dir = output_dir / "patients"
    if patient_dir.exists():
        shutil.rmtree(patient_dir)
    patient_dir.mkdir(parents=True)
    staging = setup_staging(output_dir / "staging.db")
    tables = sorted(mapping.get("tables", []), key=lambda item: {"dictionary": 0, "patient": 1, "encounter": 2, "diagnosis": 3, "observation": 4, "mixed": 5}.get(item.get("role"), 9))
    counters = Counter()
    source_hash = file_sha256(source)
    with zipfile.ZipFile(source) as archive:
        for table_index, table in enumerate(tables):
            entry = table["entry"]
            if entry not in archive.namelist():
                continue
            role = table.get("role", "mixed")
            fields = table.get("fields", {})
            encoding = table.get("encoding", "utf-8-sig")
            delimiter = table.get("delimiter", ",")
            with open_entry(archive, entry, encoding) as stream:
                reader = csv.DictReader(stream, delimiter=delimiter)
                for row_number, row in enumerate(reader, 2):
                    counters["sourceRows"] += 1
                    data = mapped(row, fields)
                    pid = data.get("patient_id")
                    encounter_id = data.get("encounter_id")
                    visit = parse_date(data.get("visit_date"))
                    if not pid and encounter_id:
                        resolved = staging.execute("SELECT pid, visit_date FROM encounters WHERE encounter_id=?", (encounter_id,)).fetchone()
                        if resolved:
                            pid = resolved[0]
                            visit = visit or parse_date(resolved[1])
                    if role == "dictionary":
                        code = data.get("diagnosis_code")
                        if code:
                            staging.execute("INSERT OR REPLACE INTO code_dictionary VALUES (?,?)", (code, data.get("diagnosis_display", "")))
                        continue
                    if pid:
                        staging.execute("INSERT INTO patients(pid,age,sex,ethnicity) VALUES (?,?,?,?) ON CONFLICT(pid) DO UPDATE SET age=COALESCE(NULLIF(excluded.age,''),patients.age), sex=COALESCE(NULLIF(excluded.sex,''),patients.sex), ethnicity=COALESCE(NULLIF(excluded.ethnicity,''),patients.ethnicity)", (pid, data.get("age"), data.get("sex"), data.get("ethnicity")))
                    if encounter_id and pid:
                        staging.execute("INSERT OR REPLACE INTO encounters VALUES (?,?,?)", (encounter_id, pid, visit.isoformat() if visit else None))
                    code = data.get("diagnosis_code")
                    display = data.get("diagnosis_display", "")
                    if code and not display:
                        found = staging.execute("SELECT display FROM code_dictionary WHERE code=?", (code,)).fetchone()
                        display = found[0] if found else ""
                    if pid and code:
                        staging.execute("INSERT INTO conditions VALUES (?,?,?,?,?)", (pid, code, display, entry, row_number))
                    if not pid or not visit:
                        continue
                    metric_candidates = []
                    if data.get("observation_name") and data.get("observation_value"):
                        metric_candidates.extend(observation_metrics(data["observation_name"], data["observation_value"], data.get("observation_unit", "")))
                    for kind in DISPLAY:
                        if data.get(kind):
                            metric_candidates.append((kind, data[kind], data.get("observation_unit", "")))
                    for kind, raw_value, raw_unit in metric_candidates:
                        normalized = normalize_metric(kind, raw_value, raw_unit)
                        if not normalized:
                            counters["invalidMeasurements"] += 1
                            continue
                        number, unit, transform = normalized
                        source_column = data.get(f"__source_{kind}") or data.get("__source_observation_value") or ""
                        staging.execute("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?)", (pid, visit.isoformat(), kind, number, unit, entry, row_number, source_column, json.dumps(transform)))
                        counters["validMeasurements"] += 1
                    if row_number % 100000 == 0:
                        staging.commit()
            staging.commit()
            emit("processing", 5 + round((table_index + 1) / max(1, len(tables)) * 55), f"Processed {entry}", rows=counters["sourceRows"])

    manifest_rows = []
    issues = []
    id_map = []
    eligible = 0
    patients = staging.execute("SELECT pid,age,sex,ethnicity FROM patients ORDER BY pid").fetchall()
    for index, (pid, age, sex, ethnicity) in enumerate(patients):
        raw_conditions = staging.execute("SELECT code,display,source_file,source_row FROM conditions WHERE pid=?", (pid,)).fetchall()
        conditions = {}
        for code, display, source_file, source_row in raw_conditions:
            classified = chronic_condition(code, display)
            if classified:
                key, label = classified
                conditions.setdefault(key, {"key": key, "display": label, "source": {"table": source_file, "row": source_row, "code": code, "description": display}})
        dates = [row[0] for row in staging.execute("SELECT DISTINCT visit_date FROM events WHERE pid=? ORDER BY visit_date", (pid,)).fetchall()]
        if not conditions:
            issues.append({"patientIdHash": hashlib.sha256(pid.encode()).hexdigest(), "severity": "high", "code": "NO_TARGET_CHRONIC_DIAGNOSIS", "message": "No supported chronic diagnosis was identified."})
            continue
        if len(dates) < 10:
            issues.append({"patientIdHash": hashlib.sha256(pid.encode()).hexdigest(), "severity": "high", "code": "INSUFFICIENT_VALID_VISITS", "message": f"Only {len(dates)} visits contain valid clinical information; 10 are required."})
            continue
        selected_dates = dates[-10:]
        pseudonym = "HOSP-" + hashlib.sha256((source_hash + "|" + pid).encode()).hexdigest()[:12].upper()
        visits = []
        last_seen = {}
        for visit_index, day in enumerate(selected_dates, 1):
            rows = staging.execute("SELECT kind,value,unit,source_file,source_row,source_column,transform_json FROM events WHERE pid=? AND visit_date=?", (pid, day)).fetchall()
            measurements = {}
            for kind, value, unit, source_file, source_row, source_column, transform_json in rows:
                source_key = {"row": source_row, "column": source_column, "patientKeySha256": hashlib.sha256(pid.encode()).hexdigest()}
                measurements[kind] = {"display": DISPLAY[kind], "value": value, "unit": unit, "observed": True, "source_table": source_file, "source_key": source_key, "transformation": json.loads(transform_json)}
                if kind in {"weight", "height", "bmi"}:
                    last_seen[kind] = (parse_date(day), measurements[kind])
            current_day = parse_date(day)
            for kind, maximum_days in (("weight", 365), ("bmi", 365), ("height", 1825)):
                if kind not in measurements and kind in last_seen:
                    observed_day, original = last_seen[kind]
                    if (current_day - observed_day).days <= maximum_days:
                        copy = json.loads(json.dumps(original))
                        copy.update({"observed": False, "imputed": True, "imputation_method": "last_observation_carried_forward", "imputation_source_date": observed_day.isoformat(), "imputation_note": "Display support only; not a newly observed clinical value."})
                        measurements[kind] = copy
                        counters["imputedFields"] += 1
            visits.append({
                "visit_number": visit_index, "date": day, "status": "completed",
                "source_event_type": "normalized hospital record", "clinic_measurements": measurements,
                "consultation": {"reason_for_consultation": {"type": "longitudinal chronic-care review"},
                    "relevant_history": {"smoking": "not available", "drug_allergies": ["not available"], "frailty": "not available", "patient_priority": "not available"},
                    "interval_history": {"medication_adherence_status": "not available", "acute_complaints": "not available"},
                    "assessment_and_plan": [{"status": "source measurement review only"}], "medication_actions": []},
                "data_availability": {"reference_role": "withheld reference" if visit_index == 10 else "model input"},
            })
        age_number = int(float(age)) if age and numeric(age) is not None else None
        top_coded = age_number is not None and age_number >= 91
        if top_coded:
            age_number = 91
        patient = {
            "schema_version": "mvp2-longitudinal-patient-v3", "patient_id": pseudonym,
            "synthetic": False, "deidentified": True, "source_dataset": source.name,
            "source_date_note": "Dates are de-identified research dates and must not be interpreted as current calendar dates.",
            "age_at_visit_1": age_number, "age_top_coded": top_coded, "sex": str(sex or "unspecified").lower(),
            "ethnicity": ethnicity or "unspecified", "conditions": list(conditions.values()),
            "clinical_context": {"record_scope": "Automatically normalized hospital CSV bundle", "missingness_policy": "Critical clinical values were not fabricated. Limited LOCF is explicitly marked."},
            "visits": visits,
        }
        file_name = f"{pseudonym}.json"
        (patient_dir / file_name).write_text(json.dumps(patient, indent=2, ensure_ascii=False), encoding="utf-8")
        manifest_rows.append({"patient_id": pseudonym, "file": f"patients/{file_name}", "visits": 10})
        id_map.append((pid, pseudonym))
        eligible += 1
        if index % 100 == 0:
            emit("building_cases", 62 + round((index + 1) / max(1, len(patients)) * 30), "Building eligible longitudinal cases", patients=index + 1)

    with (output_dir / "manifest.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["patient_id", "file", "visits"])
        writer.writeheader(); writer.writerows(manifest_rows)
    with (output_dir / "restricted-id-map.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle); writer.writerow(["source_patient_id", "platform_patient_id"]); writer.writerows(id_map)
    quality = {
        "schemaVersion": "hospital-csv-pipeline-v1", "sourceRows": counters["sourceRows"],
        "patientsDiscovered": len(patients), "eligibleCases": eligible,
        "quarantinedCases": len(patients) - eligible, "validMeasurements": counters["validMeasurements"],
        "invalidMeasurements": counters["invalidMeasurements"], "imputedFields": counters["imputedFields"],
        "issues": issues[:5000], "issueCount": len(issues),
        "rules": {"minimumVisits": 10, "modelInputVisits": "1-9", "withheldReferenceVisit": 10,
                  "criticalMissingValues": "never imputed", "limitedLocf": {"weightDays": 365, "bmiDays": 365, "heightDays": 1825}},
    }
    (output_dir / "quality.json").write_text(json.dumps(quality, indent=2), encoding="utf-8")
    (output_dir / "RUN_SUMMARY.json").write_text(json.dumps({"schema_version": "hospital-csv-pipeline-v1", "imported_format": "hospital-csv-zip", **quality}, indent=2), encoding="utf-8")
    staging.close()
    emit("quality_review", 100, "Preprocessing completed and is awaiting Admin approval", eligible=eligible, quarantined=quality["quarantinedCases"])


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    inspect_parser = sub.add_parser("inspect")
    inspect_parser.add_argument("source", type=Path); inspect_parser.add_argument("output", type=Path)
    process_parser = sub.add_parser("process")
    process_parser.add_argument("source", type=Path); process_parser.add_argument("mapping", type=Path); process_parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "inspect":
            inspect_archive(args.source, args.output)
        else:
            process_archive(args.source, args.mapping, args.output)
    except Exception as error:
        emit("failed", 0, str(error), errorType=type(error).__name__)
        raise


if __name__ == "__main__":
    main()
