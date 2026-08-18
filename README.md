# NTU AI Medical Agent Evaluation Platform — MVP2

An English-language, local research platform for independent clinician evaluation of AI-generated chronic-care plans. It combines a real SQLite database, Doctor and Admin portals, validated longitudinal synthetic data, a replaceable model-provider adapter, traceable evidence, and governed result locking.

> Research prototype. Synthetic data only. Not for clinical care or medical decision support.

## Working flow

1. A Doctor self-registers or signs in from the unified login page.
2. The Doctor selects an approved shared dataset or a private dataset they uploaded.
3. The Doctor selects one validated longitudinal patient.
4. The server sends visits 1–9 to DeepSeek; visit 10 is withheld as reference evidence.
5. The Doctor evaluates one selected model run across six 1–5 dimensions, with optional text, preset tags and custom tags for every dimension.
6. Other Doctors can independently score the same run but cannot see peer scores.
7. The Admin inspects all submissions and applies mean, median or weighted mean with doctor-level and rubric-level weights.
8. Finalization records the method and weights, then locks every included assessment.

## One-click Windows launch

Double-click `Start-Platform.cmd`. It builds the production interface when needed, starts the local SQLite/API server in the background, and opens the platform. The launcher uses port 4190 or the next available port.

Double-click `Stop-Platform.cmd` to stop the process started by the launcher.

Admin demo login:

- Email: `admin@ntu-demo.local`
- Password: `123`

Doctor accounts can be created directly from the Doctor tab.

## Developer commands

Requires Node.js 20+.

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

## Storage and secrets

- SQLite database: `.data/platform.db`
- Original uploads: `.data/uploads/`
- DeepSeek configuration: `.env.local`
- Canonical schema: `db/schema.sql`

`.data/`, `.env.local`, model keys and local runtime files are ignored by Git. Never place a model key in `src/` or commit it.

## Key source files

- `src/AuthPage.jsx`: unified Doctor/Admin login and Doctor registration.
- `src/DoctorPortal.jsx`: datasets, cases, longitudinal workspace, evidence trace and scoring.
- `src/AdminPortal.jsx`: account governance, dataset review, all feedback, aggregation and final results.
- `scripts/local-api.mjs`: authenticated local REST API.
- `scripts/database.mjs`: SQLite lifecycle, password hashing and sessions.
- `scripts/dataset-importer.mjs`: ZIP/JSON/CSV validation and quarantine handling.
- `scripts/aggregation.mjs`: mean, median, two-layer weighting and locking.
- `worker/model-adapter.js`: provider registry and DeepSeek adapter.
- `scripts/serve.mjs`: production static and API server.
- `tests/mvp2-core.test.mjs`: data-quality, password and three-doctor locking tests.

See [项目指南.md](项目指南.md) for the full Chinese engineering handoff.
