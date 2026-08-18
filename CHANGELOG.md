# Changelog

## v1.0.0-mvp2 — 2026-08-18

- Rebuilt the prototype around a real local SQLite database with hashed accounts, sessions, RBAC, audit events and original-source retention.
- Added unified Doctor/Admin authentication, Doctor self-registration and Admin account deactivation.
- Added private Doctor uploads, Admin dataset approval/sharing and explicit quarantine reports.
- Integrated the supplied Synthea-SG ZIP: 369 valid patients, 33 truncated JSON files and 98 missing files.
- Added replaceable model-provider architecture and validated a real DeepSeek `deepseek-v4-pro` visit-10 plan from visits 1–9.
- Added Doctor-private per-dimension scores, free text, preset tags, custom tags, drafts and editable submissions.
- Added Admin-wide evaluation inspection, mean/median/weighted aggregation, doctor/dimension weights and immutable finalization locking.
- Added longitudinal timeline, trends and raw JSON evidence trace.
- Added a reliable production-style local server, Windows one-click launcher, data profiler and seven automated tests.

All notable local baseline versions of the AI Medical Agent Evaluation Platform are recorded here.

## v0.3.0-handbook-launcher — 2026-08-13

- Added a Windows one-click launcher that checks platform health, starts Vite in the background and opens the evaluation Workspace.
- Added a matching stop command and ignored local runtime PID/log state.
- Added a parent-directory launcher and created a local Windows desktop shortcut for direct access on this workstation.
- Added a 14-page Chinese showcase handbook covering the P0 workflow, architecture, safety boundaries and evidence.
- Added a 17-page English showcase handbook responding to four supervisor design questions.
- Documented future work for longitudinal-data visualisation, patient-specific clinician queries and claim-level evidence traceability.
- Added reproducible ReportLab build scripts for both handbook editions.
- Kept DeepSeek credentials, local clinical-review data and runtime state outside Git.

## v0.2.0-deepseek — 2026-08-12

- Added a server-side DeepSeek adapter using the official OpenAI-compatible Chat Completions API.
- Configured `deepseek-v4-pro` with non-thinking output for clinician review.
- Added a versioned chronic-care prompt with Assessment, Plan, Monitoring, Safety and Uncertainty sections.
- Captured provider, model version, prompt version, response ID and token usage.
- Added request timeout and explicit provider error handling.
- Updated local and hosted model-provider configuration.
- Ensured the Workspace requests a DeepSeek run rather than silently reusing a Mock result.
- Hardened local JSON persistence against Windows UTF-8 BOM files.
- Successfully validated the complete route with a simulated chronic-care case.
- Kept `.env.local`, API credentials, local assessments and feedback outside Git.

## v0.1.0-p0 — 2026-08-12

- Built the English clinician evaluation interface and deep navy NTU-inspired navigation.
- Added Data Intake for JSON/CSV cases, validation, mapping and import history.
- Added persistent API routes and D1/SQLite-compatible schema and migration.
- Added the Mock Medical Model Adapter.
- Added six rubric scores, safety checks, reason tags and required Case Feedback.
- Added separate Platform Feedback persistence and administrator Feedback Inbox.
- Added database-confirmed submission, assessment history, tests and design QA assets.
