# NTU AI Medical Agent Evaluation Platform — MVP2

An English-language, local research platform for independent clinician evaluation of AI-generated clinical plans. It combines a real SQLite database, Doctor and Admin portals, adaptable clinical-data ingestion, a versioned multi-model registry, traceable evidence, and governed result locking.

> Research prototype. Synthetic or locally approved, de-identified research data only. Not for clinical care or medical decision support.

## Working flow

1. A Doctor self-registers or signs in from the unified login page.
2. The Admin uploads, maps, preprocesses and approves a dataset, then optionally assigns a default model.
3. The Doctor selects one approved shared dataset and one validated patient case.
4. The server applies an adaptive task policy: one record is evaluated directly; 2–9 records withhold the latest; 10+ records use the latest ten and withhold the tenth; undated snapshots never imply chronology.
5. The Doctor evaluates one selected model run across six 1–5 dimensions, with optional text, preset tags and custom tags for every dimension.
6. Other Doctors can independently score the same run but cannot see peer scores.
7. The Admin inspects all submissions and applies mean, median or weighted mean with doctor-level and rubric-level weights.
8. Finalization records the method and weights, then locks every included assessment.

## First-time setup (recommended)

After cloning or downloading the repository on a new Windows computer, double-click `First-Time-Setup.cmd` or `首次安装向导.cmd`.

The bilingual wizard:

1. checks that Node.js 20+, npm and Python 3.10+ are available;
2. installs the project dependencies when they are missing;
3. optionally configures DeepSeek as a starter provider; additional DeepSeek, Qwen, OpenAI, GLM or OpenAI-compatible endpoints are added later through Admin > Model registry;
4. builds the production interface and runs the automated test suite;
5. records a non-sensitive local setup status and starts the verified local service.

The API-key input is hidden. It is never printed, logged, committed, or sent anywhere except to the configured model provider when the user requests model generation. A user may skip the key and explore the interface, but model generation will remain unavailable.

`Start-Platform.cmd` and `一键启动-AI医疗评估平台.cmd` automatically redirect to the setup wizard when dependencies or `.env.local` are missing. After the first successful setup, use either launcher normally.

## One-click Windows launch

Double-click `Start-Platform.cmd`, `一键启动-AI医疗评估平台.cmd`, or the desktop shortcut `AI医疗评估平台-MVP2`. The launcher reuses a service only when its instance ID, PID, project path and port all match. Stale records and unrelated services are never reused; if 4190 is occupied, a new verified instance automatically uses 4191–4199. It rebuilds only when source files changed, starts the local SQLite/API server in the background, verifies the local database/model registry health, and opens the verified port. Diagnostic logs and runtime identity are stored under `.runtime/`.

Double-click `Stop-Platform.cmd` to stop only the process whose runtime identity is verified for this project.

Admin demo login:

- Email: `admin@ntu-demo.local`
- Password: `123`

Doctor accounts can be created directly from the Doctor tab.

## Developer commands

Requires Node.js 20+ and Python 3.10+. Python uses only its standard library and runs the local hospital CSV discovery and preprocessing worker.

```powershell
npm install
npm run build
npm start -- 4190
npm test
```

`npm run dev` remains available, but on some Windows-managed environments Vite dependency pre-bundling may be blocked by parent-folder permissions. `npm run build` plus `npm start` is the supported reliable local path.

## Data quality result for the supplied ZIP

The dataset describes itself as a 500-patient Synthea-SG cohort. The actual archive contains:

- 369 complete, parseable longitudinal records with 10 visits;
- 33 JSON files truncated exactly at 256 KiB and therefore invalid;
- 98 manifest-declared patient files that are absent.

MVP2 imports the 369 complete cases and quarantines all 131 incomplete entries. It does not fabricate or impute entire missing patient records. Original ZIP files, source filenames, SHA-256 hashes, issue codes and per-case evidence paths are retained locally.

## Governed hospital CSV preprocessing

Only Admin can upload a ZIP containing multiple `.csv` or `.csv.gz` tables. The browser sends the file in resumable 4 MB chunks, so the former 40 MB JSON-body limit does not apply to this workflow. The local background pipeline then:

1. fingerprints and preserves the immutable raw upload;
2. discovers tables, encodings, delimiters, fields, sample types and candidate relationships;
3. proposes rules-based canonical mappings with confidence and evidence;
4. pauses for Admin mapping confirmation;
5. locally de-identifies, de-duplicates, normalizes supported units, validates ranges and constructs visits;
6. accepts any diagnosis type when at least one meaningful clinical record is linked to a patient; unresolvable patient IDs or empty clinical records remain quarantined;
7. routes each case as `single_visit`, `short_longitudinal`, `standard_longitudinal`, or `undated_snapshot` and applies the matching reference policy;
8. produces an inspectable quality report and pauses again for Admin approval.

Raw hospital data is never sent to a model during preprocessing. The canonical mapping covers demographics, encounters, diagnoses, generic observations, vital signs/labs, medications, procedures, allergies and restricted clinical notes. Unknown fields are ignored until mapped; unknown units are never guessed; critical missing clinical values are never generated. Limited LOCF is restricted to height, weight and BMI, and every carried value retains an explicit imputation flag and source date. Clinical notes are withheld from model input until de-identification and Admin approval.

## Model registry and blinded evaluation batches

Admin > Model registry stores versioned provider configurations for DeepSeek, Qwen, OpenAI, GLM and other OpenAI-compatible Chat Completions endpoints. Each configuration records provider/Base URL/Model ID, local encrypted credential, capability and specialty tags, Admin prompt extension, temperature, token limit and timeout. Dataset routing is suggested from tags but requires Admin confirmation. The same case can be evaluated in separate model-specific batches; Doctors see only labels such as `Model A`, while Admin retains the real provider/model identity. A failed model call never silently switches provider.

## Storage and secrets

- SQLite database: `.data/platform.db`
- Original uploads: `.data/uploads/`
- Large hospital ingestion jobs: `.data/ingestion/`
- Starter model configuration: `.env.local`
- Versioned model registry: SQLite `model_configs`; encrypted secret key: `.data/secrets/model-registry.key`
- Canonical schema: `db/schema.sql`

`.data/`, `.env.local`, model keys and local runtime files are ignored by Git. Never place a model key in `src/` or commit it.

## Key source files

- `src/AuthPage.jsx`: unified Doctor/Admin login and Doctor registration.
- `src/DoctorPortal.jsx`: datasets, cases, longitudinal workspace, evidence trace and scoring.
- `src/AdminPortal.jsx`: account governance, Admin-only dataset intake, model registry/routing, all feedback, aggregation and final results.
- `scripts/local-api.mjs`: authenticated local REST API.
- `scripts/database.mjs`: SQLite lifecycle, password hashing and sessions.
- `scripts/dataset-importer.mjs`: ZIP/JSON/CSV validation and quarantine handling.
- `scripts/ingestion-service.mjs`: resumable uploads, persistent processing jobs, mapping approval and immutable releases.
- `scripts/hospital-csv-pipeline.py`: local multi-table CSV/CSV.GZ discovery and preprocessing worker.
- `scripts/aggregation.mjs`: mean, median, two-layer weighting and locking.
- `worker/model-adapter.js`: OpenAI-compatible provider adapters and adaptive task prompts.
- `scripts/model-registry.mjs`: versioned model configuration, local credential encryption and dataset routing.
- `scripts/serve.mjs`: production static and API server.
- `tests/mvp2-core.test.mjs`: data-quality, password and three-doctor locking tests.
- `tests/hospital-ingestion.test.mjs`: multi-table discovery, eligibility, quarantine and Admin-approval integration tests.

See [项目指南.md](项目指南.md) for the full Chinese engineering handoff.
