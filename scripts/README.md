# Local backend and operations / 本地后端与运维

[Project home](../README.md) · [Architecture](../docs/architecture/README.md)

Scripts remain in their existing paths so imports, tests and Windows launchers continue to work. This directory contains both backend services and command-line utilities, grouped below by role.

| Group | Files | Responsibility |
| --- | --- | --- |
| Server/API | [serve.mjs](serve.mjs), [local-api.mjs](local-api.mjs) | Local static server, authentication/authorization and workflow endpoints |
| Database/domain | [database.mjs](database.mjs), [domain.mjs](domain.mjs) | SQLite, sessions, migrations, serialization, task/evidence rules |
| Standard intake | [dataset-importer.mjs](dataset-importer.mjs) | Standard dataset validation and quarantine |
| Hospital intake | [ingestion-service.mjs](ingestion-service.mjs), [hospital-csv-pipeline.py](hospital-csv-pipeline.py) | Chunked raw ZIP upload, mapping, preprocessing and approval |
| Model configuration | [model-registry.mjs](model-registry.mjs) | Versioned models, locally encrypted credentials and routing |
| Evaluation | [aggregation.mjs](aggregation.mjs) | Statistical aggregation and immutable finalization |
| Setup/launch | [first-time-setup.ps1](first-time-setup.ps1), [start-platform.ps1](start-platform.ps1), [stop-platform.ps1](stop-platform.ps1) | New-computer setup and verified local service lifecycle |
| Build compatibility | [prepare-sites-build.mjs](prepare-sites-build.mjs) | Package the separate legacy hosting target |
| Offline diagnostics | [profile-dataset.mjs](profile-dataset.mjs), [profile-hosp-dataset.py](profile-hosp-dataset.py), [verify-processed-import.mjs](verify-processed-import.mjs) | Dataset profiling and import verification |
| Local pilot utilities | [build-mimic-hosp-pilot.py](build-mimic-hosp-pilot.py), [import-local-derived-dataset.mjs](import-local-derived-dataset.mjs) | Local derived-cohort preparation/import; not public patient-data distribution |

The shared provider adapter is [worker/model-adapter.js](../worker/model-adapter.js). Schema definitions are in [db/schema.sql](../db/schema.sql). Runtime state and research data belong under Git-ignored `.data/` and `.runtime/`, never in this code directory.
