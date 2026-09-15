#!/usr/bin/env python3
"""Build a small, local-only MIMIC-IV HOSP pilot ZIP for ingestion validation.

The source CSV.GZ files are never modified. The pilot preserves original headers
and values for the first N admitted subjects and keeps the small code dictionaries.
It is intended for platform compatibility tests, not analytical sampling.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import tempfile
import zipfile
from pathlib import Path


PATIENT_TABLES = (
    "patients.csv.gz",
    "admissions.csv.gz",
    "diagnoses_icd.csv.gz",
    "omr.csv.gz",
    "labevents.csv.gz",
    "prescriptions.csv.gz",
    "procedures_icd.csv.gz",
)

DICTIONARIES = (
    "d_icd_diagnoses.csv.gz",
    "d_icd_procedures.csv.gz",
    "d_labitems.csv.gz",
)


def subject_number(value: str) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def choose_subjects(source: Path, count: int) -> list[str]:
    selected: list[str] = []
    seen: set[str] = set()
    with gzip.open(source / "admissions.csv.gz", "rt", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            subject_id = str(row.get("subject_id", "")).strip()
            if subject_id and subject_id not in seen:
                selected.append(subject_id)
                seen.add(subject_id)
                if len(selected) >= count:
                    break
    if not selected:
        raise ValueError("No subject_id values were found in admissions.csv.gz.")
    return selected


def filter_table(source: Path, target: Path, selected: set[str], maximum_subject: int) -> dict:
    rows_read = 0
    rows_written = 0
    monotonic = True
    previous_subject: int | None = None
    passed_selected_range = False
    with gzip.open(source, "rt", encoding="utf-8-sig", newline="") as input_handle:
        reader = csv.DictReader(input_handle)
        if "subject_id" not in (reader.fieldnames or []):
            raise ValueError(f"{source.name} has no subject_id column.")
        with gzip.open(target, "wt", encoding="utf-8", newline="") as output_handle:
            writer = csv.DictWriter(output_handle, fieldnames=reader.fieldnames)
            writer.writeheader()
            for row in reader:
                rows_read += 1
                current_subject = subject_number(row.get("subject_id"))
                if current_subject is not None and previous_subject is not None and current_subject < previous_subject:
                    monotonic = False
                if current_subject is not None:
                    previous_subject = current_subject
                    if monotonic and current_subject > maximum_subject:
                        passed_selected_range = True
                subject_id = str(row.get("subject_id", "")).strip()
                if subject_id in selected:
                    writer.writerow(row)
                    rows_written += 1
                if passed_selected_range:
                    break
    return {"rowsRead": rows_read, "rowsWritten": rows_written, "sortedFastPath": monotonic and passed_selected_range}


def build(source: Path, output: Path, count: int) -> dict:
    if not source.is_dir():
        raise ValueError(f"Source directory does not exist: {source}")
    required = [name for name in (*PATIENT_TABLES, *DICTIONARIES) if not (source / name).is_file()]
    if required:
        raise ValueError("Required pilot tables are missing: " + ", ".join(required))
    subjects = choose_subjects(source, count)
    selected = set(subjects)
    maximum_subject = max(subject_number(value) or 0 for value in subjects)
    output.parent.mkdir(parents=True, exist_ok=True)
    stats: dict[str, dict] = {}
    with tempfile.TemporaryDirectory(prefix="mimic-hosp-pilot-", dir=output.parent) as temp_name:
        temp = Path(temp_name)
        for name in PATIENT_TABLES:
            target = temp / name
            stats[name] = filter_table(source / name, target, selected, maximum_subject)
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
            for name in PATIENT_TABLES:
                archive.write(temp / name, f"hosp/{name}")
            for name in DICTIONARIES:
                archive.write(source / name, f"hosp/{name}")
    return {
        "source": str(source.resolve()),
        "output": str(output.resolve()),
        "selectedSubjectCount": len(subjects),
        "selectedSubjectIds": subjects,
        "tables": stats,
        "outputBytes": output.stat().st_size,
        "note": "Controlled de-identified research data; pilot remains local and must not be committed.",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--subjects", type=int, default=25)
    args = parser.parse_args()
    if args.subjects < 1 or args.subjects > 1000:
        raise ValueError("--subjects must be between 1 and 1000.")
    print(json.dumps(build(args.source, args.output, args.subjects), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
