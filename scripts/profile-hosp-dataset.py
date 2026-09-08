"""Read-only compatibility profile for a MIMIC-IV-style hosp.zip archive."""

from __future__ import annotations

import csv
import gzip
import io
import json
import math
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path


def rows_from_gzip_entry(archive: zipfile.ZipFile, entry: str):
    with archive.open(entry, "r") as zipped_stream:
        with gzip.GzipFile(fileobj=zipped_stream, mode="rb") as gzip_stream:
            with io.TextIOWrapper(gzip_stream, encoding="utf-8", newline="") as text_stream:
                yield from csv.DictReader(text_stream)


def percentile(values: list[int | float], fraction: float):
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(fraction * len(ordered)) - 1))
    return ordered[index]


def distribution(values):
    values = list(values)
    if not values:
        return {"count": 0}
    return {
        "count": len(values),
        "min": min(values),
        "median": percentile(values, 0.5),
        "p90": percentile(values, 0.9),
        "p95": percentile(values, 0.95),
        "max": max(values),
        "mean": round(sum(values) / len(values), 3),
    }


def parse_timestamp(value: str):
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def diagnose_group(code: str, version: str):
    normalized = (code or "").upper().replace(".", "")
    if version == "9":
        if normalized.startswith("250"):
            return "diabetes"
        if normalized.startswith("401") or normalized.startswith("402") or normalized.startswith("403") or normalized.startswith("404") or normalized.startswith("405"):
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


def profile(source: Path):
    result = {
        "source": str(source.resolve()),
        "source_bytes": source.stat().st_size,
        "profile_scope": {
            "fully_scanned": ["patients", "admissions", "diagnoses_icd", "omr"],
            "header_only": [
                "drgcodes", "d_hcpcs", "d_icd_diagnoses", "d_icd_procedures", "d_labitems",
                "emar", "emar_detail", "hcpcsevents", "microbiologyevents", "pharmacy", "poe",
                "poe_detail", "procedures_icd", "provider", "services", "transfers",
            ],
        },
    }

    with zipfile.ZipFile(source, "r") as archive:
        entries = archive.infolist()
        result["archive"] = {
            "entry_count": len(entries),
            "csv_gz_count": sum(item.filename.endswith(".csv.gz") for item in entries),
            "total_stored_bytes": sum(item.file_size for item in entries),
            "suspicious_path_count": sum(
                ".." in Path(item.filename).parts or Path(item.filename).is_absolute() for item in entries
            ),
            "entries": [item.filename for item in entries],
        }

        patient_ids = set()
        patient_rows = 0
        patient_duplicates = 0
        genders = Counter()
        anchor_ages = []
        missing_dod = 0
        for row in rows_from_gzip_entry(archive, "hosp/patients.csv.gz"):
            patient_rows += 1
            subject_id = row.get("subject_id", "").strip()
            if subject_id in patient_ids:
                patient_duplicates += 1
            patient_ids.add(subject_id)
            genders[row.get("gender", "") or "missing"] += 1
            try:
                anchor_ages.append(int(row.get("anchor_age", "")))
            except ValueError:
                pass
            if not row.get("dod"):
                missing_dod += 1
        result["patients"] = {
            "rows": patient_rows,
            "unique_subject_ids": len(patient_ids),
            "duplicate_subject_rows": patient_duplicates,
            "gender_counts": dict(genders),
            "anchor_age": distribution(anchor_ages),
            "missing_dod": missing_dod,
            "missing_dod_rate": round(missing_dod / patient_rows, 6) if patient_rows else None,
        }

        admissions_by_patient = Counter()
        admission_ids = set()
        admission_subjects = set()
        admission_rows = 0
        duplicate_hadm = 0
        orphan_subjects = 0
        invalid_times = 0
        discharge_before_admit = 0
        admissions_per_year = Counter()
        for row in rows_from_gzip_entry(archive, "hosp/admissions.csv.gz"):
            admission_rows += 1
            subject_id = row.get("subject_id", "").strip()
            hadm_id = row.get("hadm_id", "").strip()
            if subject_id not in patient_ids:
                orphan_subjects += 1
            admission_subjects.add(subject_id)
            admissions_by_patient[subject_id] += 1
            if hadm_id in admission_ids:
                duplicate_hadm += 1
            admission_ids.add(hadm_id)
            admitted = parse_timestamp(row.get("admittime", ""))
            discharged = parse_timestamp(row.get("dischtime", ""))
            if not admitted or not discharged:
                invalid_times += 1
            else:
                admissions_per_year[str(admitted.year)] += 1
                if discharged < admitted:
                    discharge_before_admit += 1
        admission_counts = list(admissions_by_patient.values())
        result["admissions"] = {
            "rows": admission_rows,
            "unique_hadm_ids": len(admission_ids),
            "duplicate_hadm_rows": duplicate_hadm,
            "unique_subject_ids": len(admission_subjects),
            "orphan_subject_rows": orphan_subjects,
            "invalid_or_missing_time_rows": invalid_times,
            "discharge_before_admit_rows": discharge_before_admit,
            "admissions_per_patient": distribution(admission_counts),
            "patients_with_2plus_admissions": sum(value >= 2 for value in admission_counts),
            "patients_with_10plus_admissions": sum(value >= 10 for value in admission_counts),
            "year_min": min(admissions_per_year, default=None),
            "year_max": max(admissions_per_year, default=None),
        }

        diagnosis_rows = 0
        diagnosis_orphan_subjects = 0
        diagnosis_orphan_hadm = 0
        missing_diagnosis_code = 0
        condition_patients = defaultdict(set)
        distinct_codes = set()
        for row in rows_from_gzip_entry(archive, "hosp/diagnoses_icd.csv.gz"):
            diagnosis_rows += 1
            subject_id = row.get("subject_id", "").strip()
            hadm_id = row.get("hadm_id", "").strip()
            code = row.get("icd_code", "").strip()
            version = row.get("icd_version", "").strip()
            if subject_id not in patient_ids:
                diagnosis_orphan_subjects += 1
            if hadm_id not in admission_ids:
                diagnosis_orphan_hadm += 1
            if not code:
                missing_diagnosis_code += 1
            distinct_codes.add((version, code))
            group = diagnose_group(code, version)
            if group:
                condition_patients[group].add(subject_id)
        chronic_union = set().union(*condition_patients.values()) if condition_patients else set()
        all_four = set(patient_ids)
        for group in ("diabetes", "hypertension", "ckd", "hyperlipidaemia"):
            all_four &= condition_patients[group]
        result["diagnoses"] = {
            "rows": diagnosis_rows,
            "distinct_icd_version_code_pairs": len(distinct_codes),
            "orphan_subject_rows": diagnosis_orphan_subjects,
            "orphan_hadm_rows": diagnosis_orphan_hadm,
            "missing_code_rows": missing_diagnosis_code,
            "chronic_condition_patient_counts": {key: len(value) for key, value in condition_patients.items()},
            "patients_with_any_target_chronic_condition": len(chronic_union),
            "patients_with_all_four_target_conditions": len(all_four),
        }

        omr_rows = 0
        omr_subjects = set()
        omr_orphan_subjects = 0
        omr_missing_values = 0
        omr_names = Counter()
        omr_dates_by_patient = defaultdict(set)
        malformed_bp = 0
        for row in rows_from_gzip_entry(archive, "hosp/omr.csv.gz"):
            omr_rows += 1
            subject_id = row.get("subject_id", "").strip()
            chartdate = row.get("chartdate", "").strip()
            result_name = row.get("result_name", "").strip()
            result_value = row.get("result_value", "").strip()
            if subject_id not in patient_ids:
                omr_orphan_subjects += 1
            omr_subjects.add(subject_id)
            if chartdate:
                omr_dates_by_patient[subject_id].add(chartdate)
            omr_names[result_name or "missing"] += 1
            if not result_value:
                omr_missing_values += 1
            if result_name == "Blood Pressure" and result_value and "/" not in result_value:
                malformed_bp += 1
        omr_date_counts = [len(value) for value in omr_dates_by_patient.values()]
        selected_metric_names = {
            name: count
            for name, count in sorted(omr_names.items())
            if any(token in name.lower() for token in ("blood pressure", "egfr", "a1c", "glyco", "ldl", "cholesterol"))
        }
        omr_10plus_subjects = {subject_id for subject_id, dates in omr_dates_by_patient.items() if len(dates) >= 10}
        admission_10plus_subjects = {subject_id for subject_id, count in admissions_by_patient.items() if count >= 10}
        result["omr"] = {
            "rows": omr_rows,
            "unique_subject_ids": len(omr_subjects),
            "orphan_subject_rows": omr_orphan_subjects,
            "missing_result_value_rows": omr_missing_values,
            "distinct_dates_per_patient": distribution(omr_date_counts),
            "patients_with_2plus_dates": sum(value >= 2 for value in omr_date_counts),
            "patients_with_10plus_dates": sum(value >= 10 for value in omr_date_counts),
            "malformed_blood_pressure_rows": malformed_bp,
            "top_result_names": dict(omr_names.most_common(20)),
            "selected_metric_result_names": selected_metric_names,
        }

        result["platform_fit"] = {
            "direct_import_supported": False,
            "reason": "The current MVP2 ZIP importer requires manifest.csv and per-patient JSON files; this archive contains relational CSV.GZ tables.",
            "candidate_visit_sources": ["admissions.admittime", "omr.chartdate"],
            "reference_visit_policy_needed": True,
            "missing_core_table": "labevents.csv.gz is not present, so d_labitems alone cannot provide laboratory results.",
            "eligible_cohort_counts": {
                "target_chronic_condition_and_10plus_admissions": len(chronic_union & admission_10plus_subjects),
                "target_chronic_condition_and_10plus_omr_dates": len(chronic_union & omr_10plus_subjects),
                "all_four_target_conditions_and_10plus_omr_dates": len(all_four & omr_10plus_subjects),
                "target_chronic_condition_and_either_10plus_source_dates": len(chronic_union & (admission_10plus_subjects | omr_10plus_subjects)),
            },
        }
    return result


def main():
    source = Path(sys.argv[1] if len(sys.argv) > 1 else "hosp.zip")
    output = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    report = profile(source)
    payload = json.dumps(report, ensure_ascii=False, indent=2)
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(payload, encoding="utf-8")
    print(payload)


if __name__ == "__main__":
    main()
