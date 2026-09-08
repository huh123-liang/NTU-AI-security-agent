"""Build an auditable MVP2 pilot dataset from a MIMIC-IV HOSP archive.

The source ZIP is streamed and never unpacked as a whole. Every exported case
has ten observed standard blood-pressure dates. Missing laboratory values are
left unavailable rather than fabricated.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import sys
import zipfile
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path


CONDITION_LABELS = {
    "hypertension": "Hypertension",
    "hyperlipidaemia": "Hyperlipidaemia",
    "diabetes": "Diabetes mellitus",
    "ckd": "Chronic kidney disease",
}
SELECTION_SEED = "mvp2-mimic-hosp-bp-pilot-v1"


def rows_from_gzip_entry(archive: zipfile.ZipFile, entry: str):
    with archive.open(entry, "r") as zipped_stream:
        with gzip.GzipFile(fileobj=zipped_stream, mode="rb") as gzip_stream:
            with io.TextIOWrapper(gzip_stream, encoding="utf-8", newline="") as text_stream:
                yield from csv.DictReader(text_stream)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_date(value: str) -> date | None:
    try:
        return date.fromisoformat((value or "")[:10])
    except ValueError:
        return None


def diagnosis_group(code: str, version: str) -> str | None:
    normalized = (code or "").upper().replace(".", "")
    if version == "9":
        if normalized.startswith("250"):
            return "diabetes"
        if normalized.startswith(("401", "402", "403", "404", "405")):
            return "hypertension"
        if normalized.startswith("585"):
            return "ckd"
        if normalized.startswith(("2720", "2721", "2722", "2723", "2724")):
            return "hyperlipidaemia"
    else:
        if normalized.startswith(("E08", "E09", "E10", "E11", "E12", "E13")):
            return "diabetes"
        if normalized.startswith(("I10", "I11", "I12", "I13", "I15")):
            return "hypertension"
        if normalized.startswith("N18"):
            return "ckd"
        if normalized.startswith("E78"):
            return "hyperlipidaemia"
    return None


def valid_bp(value: str) -> tuple[float, float] | None:
    try:
        systolic_raw, diastolic_raw = value.strip().split("/", 1)
        systolic = float(systolic_raw)
        diastolic = float(diastolic_raw)
    except (AttributeError, ValueError):
        return None
    if not (60 <= systolic <= 260 and 30 <= diastolic <= 160 and systolic > diastolic):
        return None
    return systolic, diastolic


def valid_number(value: str, low: float, high: float) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and low <= number <= high else None


def rounded(value: float) -> int | float:
    return int(value) if value.is_integer() else round(value, 2)


def stable_key(subject_id: str) -> str:
    return hashlib.sha256(f"{SELECTION_SEED}:{subject_id}".encode()).hexdigest()


def public_patient_id(subject_id: str) -> str:
    return f"MIMIC-HOSP-{stable_key(subject_id)[:10].upper()}"


def choose_balanced(candidates: list[str], profiles: dict[str, dict], limit: int) -> list[str]:
    strata: dict[tuple, list[str]] = defaultdict(list)
    for subject_id in candidates:
        strata[tuple(sorted(profiles[subject_id]))].append(subject_id)
    for values in strata.values():
        values.sort(key=stable_key)
    ordered_strata = sorted(strata, key=lambda key: (-len(key), key))
    selected: list[str] = []
    cursor = 0
    while len(selected) < limit and ordered_strata:
        key = ordered_strata[cursor % len(ordered_strata)]
        values = strata[key]
        if values:
            selected.append(values.pop(0))
        if not values:
            ordered_strata.remove(key)
            cursor = 0
        else:
            cursor += 1
    return selected


def source_measurement(display: str, value: float, unit: str, row: dict, subject_id: str, *, imputed=False, source_date=None):
    item = {
        "display": display,
        "value": rounded(value),
        "unit": unit,
        "observed": not imputed,
        "source_table": "hosp.omr",
        "source_key": {
            "subject_key_sha256": stable_key(subject_id),
            "chartdate": source_date or row.get("chartdate"),
            "seq_num": row.get("seq_num"),
            "result_name": row.get("result_name"),
        },
    }
    if imputed:
        item.update({
            "imputed": True,
            "imputation_method": "last_observation_carried_forward",
            "imputation_note": "Display support only; not a newly observed clinical value.",
        })
    return item


def latest_before(observations: list[tuple[date, float, dict]], target: date, max_days: int):
    eligible = [item for item in observations if item[0] <= target and (target - item[0]).days <= max_days]
    return eligible[-1] if eligible else None


def build_patient(subject_id: str, selected_rows: list[dict], conditions: dict, demographic: dict, race: str | None):
    by_date: dict[date, list[dict]] = defaultdict(list)
    for row in selected_rows:
        parsed = parse_date(row.get("chartdate", ""))
        if parsed:
            by_date[parsed].append(row)

    bp_dates = []
    bmi_observations = []
    weight_observations = []
    height_observations = []
    egfr_by_date: dict[date, list[tuple[float, dict]]] = defaultdict(list)
    for chartdate, rows in by_date.items():
        bp_rows = []
        for row in rows:
            name = row.get("result_name", "")
            raw = row.get("result_value", "")
            if name == "Blood Pressure":
                parsed_bp = valid_bp(raw)
                if parsed_bp:
                    bp_rows.append((int(row.get("seq_num") or 0), parsed_bp, row))
            elif name in {"BMI (kg/m2)", "BMI"}:
                value = valid_number(raw, 10, 80)
                if value is not None:
                    bmi_observations.append((chartdate, value, row))
            elif name in {"Weight (Lbs)", "Weight"}:
                value = valid_number(raw, 40, 800)
                if value is not None:
                    weight_observations.append((chartdate, value, row))
            elif name in {"Height (Inches)", "Height"}:
                value = valid_number(raw, 36, 96)
                if value is not None:
                    height_observations.append((chartdate, value, row))
            elif name == "eGFR":
                value = valid_number(raw, 1, 200)
                if value is not None:
                    egfr_by_date[chartdate].append((value, row))
        if bp_rows:
            bp_rows.sort(key=lambda item: item[0])
            bp_dates.append((chartdate, bp_rows[0][1], bp_rows[0][2]))

    bp_dates.sort(key=lambda item: item[0])
    bmi_observations.sort(key=lambda item: item[0])
    weight_observations.sort(key=lambda item: item[0])
    height_observations.sort(key=lambda item: item[0])
    chosen = bp_dates[-10:]
    if len(chosen) != 10:
        raise ValueError(f"Expected 10 valid BP dates, found {len(chosen)}")

    visits = []
    for index, (chartdate, (systolic, diastolic), bp_row) in enumerate(chosen, start=1):
        measurements = {
            "systolic_bp": source_measurement("Systolic blood pressure", systolic, "mmHg", bp_row, subject_id),
            "diastolic_bp": source_measurement("Diastolic blood pressure", diastolic, "mmHg", bp_row, subject_id),
        }
        for key, label, unit, observations, max_days in (
            ("bmi", "BMI", "kg/m²", bmi_observations, 365),
            ("weight", "Weight", "lb", weight_observations, 365),
            ("height", "Height", "in", height_observations, 1825),
        ):
            exact = next((item for item in reversed(observations) if item[0] == chartdate), None)
            picked = exact or latest_before(observations, chartdate, max_days)
            if picked:
                source_date, value, source_row = picked
                measurements[key] = source_measurement(label, value, unit, source_row, subject_id, imputed=source_date != chartdate, source_date=source_date.isoformat())
        if egfr_by_date.get(chartdate):
            value, source_row = egfr_by_date[chartdate][0]
            measurements["egfr"] = source_measurement("eGFR", value, "mL/min/1.73m²", source_row, subject_id)

        visits.append({
            "visit_number": index,
            "date": chartdate.isoformat(),
            "status": "completed",
            "source_event_type": "outpatient_measurement_record",
            "clinic_measurements": measurements,
            "consultation": {
                "reason_for_consultation": {"type": "longitudinal blood-pressure measurement review"},
                "relevant_history": {
                    "smoking": "not available in supplied HOSP module",
                    "drug_allergies": ["not available in supplied HOSP module"],
                    "frailty": "not available in supplied HOSP module",
                    "patient_priority": "not available in supplied HOSP module",
                },
                "interval_history": {
                    "medication_adherence_status": "not available in supplied HOSP module",
                    "acute_complaints": "not available in supplied HOSP module",
                },
                "assessment_and_plan": [{"status": "source_measurement_review_only"}],
                "medication_actions": [],
            },
            "data_availability": {
                "blood_pressure": "observed",
                "laboratory_panel": "not available; labevents was absent from the supplied archive",
                "medications": "not available; prescriptions was absent from the supplied archive",
                "reference_role": "withheld future measurement" if index == 10 else "model input",
            },
        })

    first_year = chosen[0][0].year
    anchor_age = int(demographic.get("anchor_age") or 0)
    anchor_year = int(demographic.get("anchor_year") or first_year)
    calculated_age = max(18, anchor_age + first_year - anchor_year)
    age_top_coded = anchor_age >= 91
    age = 91 if age_top_coded else calculated_age
    condition_items = []
    for group, item in sorted(conditions.items()):
        if item["date"] <= chosen[0][0]:
            condition_items.append({
                "key": group,
                "display": CONDITION_LABELS[group],
                "source": {
                    "table": "hosp.diagnoses_icd",
                    "icd_code": item["code"],
                    "icd_version": item["version"],
                    "first_recorded_date": item["date"].isoformat(),
                    "long_title": item.get("title") or "",
                },
            })
    if not condition_items:
        raise ValueError("No target chronic diagnosis preceded the selected timeline")

    return {
        "schema_version": "mvp2-longitudinal-patient-v2",
        "patient_id": public_patient_id(subject_id),
        "synthetic": False,
        "deidentified": True,
        "source_dataset": "MIMIC-IV HOSP-derived local pilot",
        "source_date_note": "Dates are de-identified research dates and must not be interpreted as current calendar dates.",
        "age_at_visit_1": age,
        "age_top_coded": age_top_coded,
        "age_note": "Age 91+ is top-coded in the source data." if age_top_coded else "Age derived from anchor age and de-identified year.",
        "sex": {"F": "female", "M": "male"}.get(demographic.get("gender"), "unspecified"),
        "ethnicity": race or "not available",
        "conditions": condition_items,
        "clinical_context": {
            "record_scope": "BP-centred longitudinal OMR subset",
            "missingness_policy": "No laboratory or medication value was fabricated. Limited LOCF is flagged field-by-field for display support only.",
        },
        "visits": visits,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--limit", type=int, default=100)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    report_path = args.output.with_name(f"{args.output.stem}-report.json")
    id_map_path = args.output.with_name(f"{args.output.stem}-restricted-id-map.csv")

    print("[1/6] Reading code dictionary and admissions…", flush=True)
    with zipfile.ZipFile(args.source, "r") as archive:
        titles = {(row["icd_version"], row["icd_code"]): row.get("long_title", "") for row in rows_from_gzip_entry(archive, "hosp/d_icd_diagnoses.csv.gz")}
        hadm_dates = {}
        patient_race = {}
        patient_race_date = {}
        for row in rows_from_gzip_entry(archive, "hosp/admissions.csv.gz"):
            admitted = parse_date(row.get("admittime", ""))
            if not admitted:
                continue
            hadm_dates[row["hadm_id"]] = admitted
            subject_id = row["subject_id"]
            if subject_id not in patient_race_date or admitted > patient_race_date[subject_id]:
                patient_race_date[subject_id] = admitted
                patient_race[subject_id] = (row.get("race") or "not available").title()

        print("[2/6] Identifying chronic diagnoses…", flush=True)
        diagnoses: dict[str, dict] = defaultdict(dict)
        for row in rows_from_gzip_entry(archive, "hosp/diagnoses_icd.csv.gz"):
            group = diagnosis_group(row.get("icd_code", ""), row.get("icd_version", ""))
            if not group:
                continue
            admitted = hadm_dates.get(row.get("hadm_id", ""))
            if not admitted:
                continue
            subject_id = row["subject_id"]
            current = diagnoses[subject_id].get(group)
            if current is None or admitted < current["date"]:
                diagnoses[subject_id][group] = {
                    "date": admitted,
                    "code": row.get("icd_code", ""),
                    "version": row.get("icd_version", ""),
                    "title": titles.get((row.get("icd_version", ""), row.get("icd_code", "")), ""),
                }
        del hadm_dates

        print("[3/6] Screening for ten valid post-diagnosis BP dates…", flush=True)
        first_condition_date = {subject_id: min(item["date"] for item in groups.values()) for subject_id, groups in diagnoses.items()}
        bp_dates_seen: dict[str, set[str]] = defaultdict(set)
        rejected_bp_rows = 0
        for row in rows_from_gzip_entry(archive, "hosp/omr.csv.gz"):
            if row.get("result_name") != "Blood Pressure":
                continue
            subject_id = row.get("subject_id", "")
            diagnosis_date = first_condition_date.get(subject_id)
            chartdate = parse_date(row.get("chartdate", ""))
            if not diagnosis_date or not chartdate or chartdate < diagnosis_date:
                continue
            if not valid_bp(row.get("result_value", "")):
                rejected_bp_rows += 1
                continue
            if len(bp_dates_seen[subject_id]) < 10:
                bp_dates_seen[subject_id].add(chartdate.isoformat())
        candidates = [subject_id for subject_id, dates in bp_dates_seen.items() if len(dates) >= 10]
        selected = choose_balanced(candidates, diagnoses, min(args.limit, len(candidates)))
        selected_set = set(selected)
        if not selected:
            raise RuntimeError("No patient met the ten-date BP eligibility rule")

        print(f"[4/6] Extracting all source rows for {len(selected)} selected patients…", flush=True)
        patient_rows: dict[str, list[dict]] = defaultdict(list)
        for row in rows_from_gzip_entry(archive, "hosp/omr.csv.gz"):
            if row.get("subject_id") in selected_set:
                patient_rows[row["subject_id"]].append(row)
        demographics = {}
        for row in rows_from_gzip_entry(archive, "hosp/patients.csv.gz"):
            if row.get("subject_id") in selected_set:
                demographics[row["subject_id"]] = row

    print("[5/6] Building auditable patient records…", flush=True)
    patients = []
    dropped = []
    imputed_fields = 0
    observed_measurements = 0
    for subject_id in selected:
        try:
            patient = build_patient(subject_id, patient_rows[subject_id], diagnoses[subject_id], demographics.get(subject_id, {}), patient_race.get(subject_id))
            for visit in patient["visits"]:
                for item in visit["clinic_measurements"].values():
                    if item.get("imputed"):
                        imputed_fields += 1
                    else:
                        observed_measurements += 1
            patients.append(patient)
        except Exception as error:
            dropped.append({"subject_key_sha256": stable_key(subject_id), "reason": str(error)})

    manifest_rows = [{"patient_id": patient["patient_id"], "file": f"patients/{patient['patient_id']}.json"} for patient in patients]
    summary = {
        "schema_version": "mvp2-mimic-hosp-bp-pilot-v1",
        "imported_format": "mimic-hosp-derived-longitudinal-zip",
        "source_archive_sha256": file_sha256(args.source),
        "source_archive_name": args.source.name,
        "generated_at": datetime.now().astimezone().isoformat(),
        "selection_seed": SELECTION_SEED,
        "requested_cases": args.limit,
        "eligible_candidates": len(candidates),
        "exported_cases": len(patients),
        "dropped_after_selection": dropped,
        "rejected_implausible_bp_rows": rejected_bp_rows,
        "observed_measurements": observed_measurements,
        "limited_locf_fields": imputed_fields,
        "missing_data_policy": {
            "blood_pressure": "Require ten observed standard Blood Pressure dates; reject implausible values.",
            "bmi_weight_height": "Use exact-date value when available; otherwise flagged limited LOCF (365 days, height 1825 days).",
            "hba1c_ldl": "Unavailable because the supplied archive has no labevents table; never imputed.",
            "egfr": "Included only when directly observed in OMR; never imputed.",
            "medications": "Unavailable because the supplied archive has no prescriptions table; never imputed.",
        },
        "task_scope": "BP-centred longitudinal research pilot; visit 10 is a withheld future measurement, not a clinical ground-truth treatment plan.",
    }
    readme = """# MIMIC-IV HOSP-derived BP pilot\n\nThis local-only bundle contains de-identified, pseudonymised longitudinal records for MVP2 testing. Each patient has ten observed standard blood-pressure dates after a target chronic diagnosis was recorded.\n\nMissing HbA1c, LDL and medication data were not fabricated. BMI, weight and height may use limited last-observation-carried-forward values only when explicitly marked as imputed. The restricted ID map is stored beside, not inside, this ZIP.\n"""

    print("[6/6] Writing derived ZIP, report and restricted local ID map…", flush=True)
    with zipfile.ZipFile(args.output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output_zip:
        manifest_buffer = io.StringIO(newline="")
        writer = csv.DictWriter(manifest_buffer, fieldnames=["patient_id", "file"])
        writer.writeheader()
        writer.writerows(manifest_rows)
        output_zip.writestr("manifest.csv", manifest_buffer.getvalue())
        output_zip.writestr("RUN_SUMMARY.json", json.dumps(summary, ensure_ascii=False, indent=2, default=str))
        output_zip.writestr("README.md", readme)
        for patient in patients:
            output_zip.writestr(f"patients/{patient['patient_id']}.json", json.dumps(patient, ensure_ascii=False, indent=2))
    report_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    with id_map_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["platform_patient_id", "source_subject_id", "source_subject_key_sha256"])
        writer.writeheader()
        for subject_id in selected:
            writer.writerow({"platform_patient_id": public_patient_id(subject_id), "source_subject_id": subject_id, "source_subject_key_sha256": stable_key(subject_id)})
    print(json.dumps({"zip": str(args.output), "report": str(report_path), "id_map": str(id_map_path), "exported": len(patients), "eligible": len(candidates)}, indent=2), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ETL failed: {exc}", file=sys.stderr, flush=True)
        raise
