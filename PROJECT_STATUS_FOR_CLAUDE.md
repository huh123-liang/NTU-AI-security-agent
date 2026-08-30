# AI Medical Agent Evaluation Platform — Project Status Handoff

> Prepared for Claude review  
> Status date: 30 August 2026  
> Current Git base: `v1.3.0-evidence-resilience` (`32b30f5`); Official-Run study-mode changes are working-tree updates pending the next local release tag.  
> Project root: `C:\Users\Lenovo\Desktop\NTU\NTU AI security agents\MVP2`

## 1. What this project is for

This project is a research prototype for evaluating the safety and quality of AI medical agents. Its immediate purpose is to let real doctors independently review one AI-generated chronic-care plan, score it using structured rubrics, and provide qualitative feedback. These clinician judgements are intended to become auditable Ground Truth for a future automated evaluator model.

The longer-term vision is a governed evaluation and certification platform for AI agents before hospital deployment. The present MVP does **not** claim to be a medical device, clinical decision-support system, or national certification standard.

Current research task:

1. Select a simulated longitudinal chronic-disease patient.
2. Send visits 1–9 to the configured medical LLM.
3. Ask the LLM to generate a proposed plan for visit 10.
4. Withhold the actual simulated visit-10 record as reference evidence.
5. Let multiple doctors independently score one pre-generated, fixed Official Run.
6. Let an administrator inspect, aggregate and lock the final result.

All current patient data are synthetic Synthea-SG research data. No real patient EHR or PHI is included.

## 2. Current implementation level

| Delivery level | Status | Meaning |
|---|---|---|
| Functional single-computer MVP | **Implemented** | Full Doctor/Admin flow works locally with a real SQLite database and DeepSeek API integration. |
| Controlled multi-doctor research pilot | **Partially implemented** | The workflow and data model exist, but the system is not yet deployed to a shared secure server. |
| Hospital/production deployment | **Not completed** | Security, compliance, managed infrastructure, EHR integration and formal clinical validation remain outstanding. |

## 3. Current architecture

```text
React 19 + Vite 6 frontend
          │
          │ /api/v1
          ▼
Node.js local REST API and static server
  ├─ Authentication, sessions, RBAC and audit logs
  ├─ Dataset import, validation and quarantine
  ├─ Model Provider Registry → DeepSeek
  ├─ Evidence catalogue and citation validation
  ├─ Doctor assessment service
  └─ Admin aggregation and immutable locking
          │
          ▼
SQLite database: .data/platform.db
```

The backend and database are real, but they currently run on one local Windows computer. SQLite is not a mock database and the records are not stored only in browser local storage.

## 4. Completed work

### 4.1 Authentication and roles

- [x] Unified login page with separate Doctor and Admin portal selection.
- [x] Doctor self-registration using display name, email and password.
- [x] Passwords stored using random salt plus `scrypt` hash; plaintext passwords are not stored.
- [x] Session tokens stored as hashes with expiry.
- [x] One local Admin account for demonstration.
- [x] Admin can activate or deactivate Doctor accounts.
- [x] Doctor assessments are peer-blind: a Doctor cannot see another Doctor's scores or feedback.
- [x] Admin can inspect all users, datasets, runs, scores and feedback.

### 4.2 Real SQL persistence

- [x] Real local SQLite database with WAL mode and foreign keys.
- [x] Canonical SQL schema in `db/schema.sql`.
- [x] Tables for users, sessions, datasets, data-quality issues, cases, model runs, assessments, criterion scores, finalizations, platform feedback and audit logs.
- [x] Persistent data survives browser refresh and application restart.
- [x] Local uploads and original provenance are retained outside Git.

Live local database snapshot on 24 August 2026:

| Record type | Count |
|---|---:|
| Datasets | 1 |
| Valid cases | 369 |
| Users | 6 |
| AI model runs | 43 |
| Doctor assessments | 6 |
| Criterion-level scores | 36 |
| Locked finalizations | 1 |
| Audit events | 109 |

### 4.3 Dataset governance and missing-data handling

- [x] Doctor upload support for ZIP, JSON and CSV.
- [x] Doctor uploads are private by default and visible only to the uploader and Admin.
- [x] Admin can reject, approve privately, or approve and share a dataset.
- [x] Original filename, format, source path, SHA-256, owner, timestamps and quality issues are recorded.
- [x] Supplied 500-patient archive was profiled rather than assumed complete.
- [x] 369 complete ten-visit cases are imported.
- [x] 33 truncated JSON files are quarantined as `INVALID_JSON`.
- [x] 98 manifest-declared but absent files are quarantined as `MISSING_PATIENT_FILE`.
- [x] The platform does not fabricate the 131 incomplete patients.

### 4.4 Model generation workflow

- [x] Replaceable provider architecture in `worker/model-adapter.js`.
- [x] DeepSeek is the currently installed provider; the React frontend does not call it directly.
- [x] Visits 1–9 are saved as a versioned model-input snapshot.
- [x] Visit 10 is withheld and stored separately as reference evidence.
- [x] Historical runs remain auditable; the active Doctor workflow exposes only one Admin-created Official Run per case.
- [x] Persisted asynchronous lifecycle: Preparing data, Calling model, Processing response, Validating evidence and Saved.
- [x] Cancel, retry, browser-refresh recovery and process-restart interruption handling.
- [x] Transient network retry with bounded exponential backoff for connection errors, HTTP 429 and common 5xx responses.
- [x] Authentication and request errors are not blindly retried.
- [x] Provider, model version, prompt version, response ID, usage, timestamps and errors are retained.

### 4.5 Longitudinal data and evidence traceability

- [x] Patient summary and active-condition display.
- [x] Ten-visit clinical timeline.
- [x] Longitudinal metric trend chart.
- [x] Doctor-facing clinical-record evidence view with original source path and SHA-256 provenance; raw JSON is retained for Admin/development audit.
- [x] Backend evidence catalogue limited to source measurements from visits 1–9.
- [x] Model citation tokens are checked against backend-allowed evidence IDs.
- [x] Valid citations are interactive and link the model claim to the corresponding visit, metric, chart point and JSON path.
- [x] Canonical and legacy evidence-record formats remain readable.

### 4.6 Doctor evaluation flow

- [x] One selected model response is evaluated at a time.
- [x] Six 1–5 dimensions: Accuracy, Completeness, Communication quality, Context awareness, Instruction following and Safety.
- [x] Optional free-text feedback under every dimension.
- [x] Multiple preset feedback tags under every dimension.
- [x] Doctor-defined custom feedback tags.
- [x] Safety-critical check, missing/clarification tags and overall case feedback.
- [x] Draft saving and Submitted status.
- [x] Submitted assessments remain editable until Admin finalization.
- [x] Locked assessments reject further modification.

### 4.7 Admin workflow

- [x] Doctor account administration.
- [x] Dataset review, approval and sharing controls.
- [x] Visibility into all Doctor scores, preset tags, custom tags and text feedback.
- [x] Governed aggregation at one Official Run level, preventing scores from different answers being mixed.
- [x] Arithmetic mean, median and weighted mean.
- [x] Versioned equal Doctor and six-dimension weight preset on every Official Run.
- [x] Preview does not mutate stored results.
- [x] Finalization records method, weights, included assessments and final score.
- [x] Finalization locks all included assessments and preserves the audit history.

### 4.8 UI and operational reliability

- [x] English-language Doctor and Admin portals.
- [x] Dense three-column clinical workspace with dark NTU-inspired navigation.
- [x] Login particle network, restrained generation animation and evidence-linked micro-interactions.
- [x] Windows one-click launcher and matching stop command.
- [x] Runtime instance identity using instance ID, PID, project path and port.
- [x] Stale processes and unrelated services are not reused or stopped.
- [x] Automatic fallback from port 4190 to 4191–4199.
- [x] DeepSeek network health diagnostics and actionable error messages.
- [x] Existing failed model runs remain visible as an audit trail.

### 4.9 Verification completed

- [x] `npm test`: **11/11 tests passed** on 24 August 2026.
- [x] `npm run build`: completed successfully on 24 August 2026.
- [x] Automated coverage includes password hashing, Visit 1–9 evidence restrictions, legacy evidence decoding, transient model retry, SQL lifecycle columns, 369/131 data-quality handling, three-Doctor weighted aggregation, immutable locking, static routing and Sites packaging.
- [x] A real DeepSeek run has successfully generated a visit-10 plan from visits 1–9.
- [x] A three-Doctor weighted result of 4.33/5 has been finalized and locked in the local demonstration database.
- [x] Git history is preserved through tag `v1.3.0-evidence-resilience` and a verified standalone Git bundle.

### 4.10 Official-Run study mode and usability update — 30 August 2026

- [x] Admin-only **Official responses** page: generate one fixed answer for a selected case before doctor scoring begins.
- [x] Failed Official Runs are explicitly labelled **Official failed** and expose an Admin-only **Retry official** action; failed attempts remain in the audit history and never block a future retry.
- [x] A completed replacement automatically archives the previous Official Run; historical answers and their assessments remain auditable and are never mixed with the replacement.
- [x] Doctors see only the current Official Run in the workspace; Doctor-side New run, retry and arbitrary-run scoring are removed.
- [x] Finalization is restricted to one Official Run and is blocked until at least **three distinct Doctors** have submitted. Drafts remain excluded.
- [x] Official Run stores an equal-weight study preset (Doctor and six rubric dimensions = 1.0) before scoring. The final audit retains the method, preset and included assessment IDs.
- [x] Doctor account states now distinguish Active, Scoring suspended (history readable, no score write) and Deactivated (cannot sign in). No users or assessments are physically deleted.
- [x] Doctor context is redesigned for information density: four concurrent small-multiple trends (BP, HbA1c, eGFR and LDL), rule-based source-backed research signals, and a compact clickable visit strip.
- [x] The Doctor-facing evidence dialog is now a human-readable clinical record; raw JSON remains an Admin/development audit concern.
- [x] Admin evaluation register is doctor-first: choose a Doctor, inspect their cases, then compare 2–4 assessments in detail or 5+ in a disagreement-highlighted matrix only when case, Official Run, prompt version and output hash match.
- [x] `npm run build` completed and `npm test` passed **12/12** on 30 August 2026.

## 5. Partially implemented or important limitations

- [~] **Evidence verification is structural, not semantic.** The backend confirms that a cited evidence ID exists in visits 1–9, but it does not yet prove that the cited value logically supports the surrounding clinical claim. A diagnosis could still be paired with an existing but irrelevant measurement token.
- [~] **The equal-weight Official Run preset is implemented.** A governed UI for configuring and versioning non-equal Doctor/rubric weight presets before the first score remains a next enhancement.
- [~] **Longitudinal visualisation now uses four small multiples and a compact visit strip**, but does not yet provide clinical-range overlays, event overlays or scalable visual summaries for very long histories.
- [~] **Only DeepSeek is currently installed.** The adapter boundary supports more providers, but OpenAI, local models and other medical models have not been implemented or compared.
- [~] **The model task is fixed to visits 1–9 → proposed visit 10.** General clinical questions, other prediction horizons and configurable tasks are not yet supported.
- [~] **Dataset formats are prototype-oriented.** ZIP/JSON/CSV import exists, but FHIR R4 resources and live EHR connections are not implemented.
- [~] **Current tests are core/integration tests, not a full validation programme.** Comprehensive browser E2E, accessibility, load, concurrency, security and clinical-quality tests remain outstanding.
- [~] **The current NTU branding is a text-based prototype treatment.** An authorised official logo asset and formal brand approval are still needed.

## 6. Not yet completed

### P0 — Recommended before the next serious clinician study

- [ ] Add claim-level semantic evidence checking, not only evidence-ID existence checking.
- [ ] Version Rubrics, prompts, evidence schemas and study protocols explicitly.
- [ ] Add inter-rater reliability analysis such as ICC and weighted Kappa.
- [ ] Add a governed export containing model inputs, outputs, rubric versions, Doctor scores and feedback for evaluator-model training.
- [ ] Add blinded train/validation/test splitting and leakage prevention for the future evaluator.
- [ ] Complete browser E2E tests for registration, model generation, three-Doctor scoring, Admin aggregation and locking.
- [ ] Conduct formal clinician usability testing and record required workflow changes.
- [x] Improve Admin information architecture with Doctor → case/run navigation and exact-run comparison views.

### P1 — Required for a shared research pilot

- [ ] Deploy the backend to a controlled server instead of one local computer.
- [ ] Migrate SQLite to PostgreSQL or another managed transactional database.
- [ ] Add database migrations, encrypted backups, retention policy and disaster recovery testing.
- [ ] Add HTTPS, environment-based secret management, rate limiting, cost quotas and job-queue workers.
- [ ] Replace demo authentication with stronger password policy, MFA or institutional SSO.
- [ ] Add provider configuration and comparison for additional LLMs.
- [ ] Add FHIR R4 import/export and validate mapping against target hospital systems.
- [ ] Add monitoring for API latency, model failures, token usage, cost and abnormal outputs.

### P2 — Required before hospital or certification use

- [ ] Complete ethics approval, data-use agreements and clinical governance review.
- [ ] Implement PHI de-identification, access logging, encryption at rest and key rotation.
- [ ] Assess cross-border model processing and applicable healthcare/privacy regulations.
- [ ] Establish threat modelling, penetration testing, incident response and audit-retention requirements.
- [ ] Add clinical safety filters, red-team suites and validated escalation procedures.
- [ ] Define model-version change control, calibration thresholds and certification acceptance criteria.
- [ ] Run prospective validation with authorised real clinical data and qualified clinical reviewers.
- [ ] Produce medical-device/regulatory documentation if the intended use enters regulated scope.

## 7. Key files for Claude to inspect

| Area | File |
|---|---|
| Project instructions and durable design decisions | `AGENTS.md` |
| High-level overview | `README.md` |
| Detailed Chinese engineering handoff | `项目指南.md` |
| Change history | `CHANGELOG.md` |
| Doctor workflow | `src/DoctorPortal.jsx` |
| Admin workflow | `src/AdminPortal.jsx` |
| Authentication UI | `src/AuthPage.jsx` |
| REST API and business flow | `scripts/local-api.mjs` |
| SQLite lifecycle and authentication | `scripts/database.mjs` |
| Canonical database schema | `db/schema.sql` |
| Dataset validation and quarantine | `scripts/dataset-importer.mjs` |
| Aggregation and locking | `scripts/aggregation.mjs` |
| DeepSeek/provider adapter and evidence validation | `worker/model-adapter.js` |
| Production local server | `scripts/serve.mjs` |
| One-click startup | `scripts/start-platform.ps1` |
| Automated tests | `tests/mvp2-core.test.mjs` |

## 8. How to run and verify

Requirements: Windows and Node.js 20 or newer.

```powershell
cd "C:\Users\Lenovo\Desktop\NTU\NTU AI security agents\MVP2"
npm install
npm run build
npm test
npm start -- 4190
```

The normal local-user path is to double-click `Start-Platform.cmd` or `一键启动-AI医疗评估平台.cmd`.

Demo Admin account:

```text
Email: admin@ntu-demo.local
Password: 123
```

This password is only acceptable for the local prototype and must not be reused in a deployed environment.

Secrets and local research records are intentionally excluded from Git:

- `.env.local` — DeepSeek/API configuration;
- `.data/` — SQLite database and uploads;
- `.runtime/` — PID, port, logs and runtime identity;
- `node_modules/` and `dist/` — generated dependencies and build output.

## 9. Requested review from Claude

Please review the repository as a research-platform codebase and answer the following:

1. Are the Doctor/Admin access controls enforced by the backend rather than only hidden in the UI?
2. Are there paths where one Doctor could retrieve or modify another Doctor's assessment?
3. Are finalization and locking transactionally safe and auditable?
4. Is SQLite usage safe for the current single-computer prototype, and what is the cleanest PostgreSQL migration path?
5. Are asynchronous run cancellation, retry and restart recovery idempotent and race-safe?
6. Does the evidence system distinguish token validity from semantic support clearly enough?
7. Which claims in model output require a stronger provenance schema than the current measurement-only evidence catalogue?
8. Are secrets, uploaded files and local research records reliably excluded from Git and frontend bundles?
9. Which API, input-validation, security and denial-of-service risks should be fixed first?
10. Which missing automated tests are highest priority before a multi-clinician pilot?
11. What UI/UX problems could cause clinician scoring error, fatigue or accidental submission?
12. Which parts should be refactored before adding PostgreSQL, background workers and additional model providers?

## 10. Bottom-line status

The repository contains a functioning, evidence-linked, single-computer research MVP with real backend persistence, real model integration, independent Doctor scoring and governed Admin aggregation. It is suitable for controlled local demonstrations and early workflow feedback using synthetic data.

It is **not yet suitable for real patient data, multi-hospital use, autonomous clinical decisions or certification claims**. The next major transition is from a local functional MVP to a secure, semantically validated, multi-user research pilot with formal clinical and governance evaluation.
