# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

## Confirmed Product Direction

- The current visual source of truth is `design-references/selected-evidence-lens-v1.png`; the earlier Safety Review Cockpit remains the structural baseline.
- Preserve the three-column clinical workspace and full-height deep navy navigation, while adding the selected Evidence Lens interaction, real five-stage generation trail and restrained constellation language.
- The product is an English-language desktop web prototype for clinicians evaluating one virtual doctor's response to a simulated longitudinal chronic-disease case.
- Required end-to-end screens: sign in, dashboard, case list, evaluation workspace, submission confirmation, assessment history/summary, case feedback, and platform feedback.
- Use NTU-inspired navy and restrained crimson. Keep the interface clinical, premium, dense but readable, and clearly label all patient information as simulated.
- All MVP2 implementation, data-source copies, tests, launchers and documentation must remain inside the `MVP2` folder.
- Preserve the unified Doctor/Admin login, real local SQLite storage, Doctor-private peer-blind assessments, Admin dataset governance, two-layer aggregation weights and immutable finalization lock.
- The current model task is fixed: send visits 1–9 to the provider and withhold visit 10 as reference evidence. Keep model providers behind `worker/model-adapter.js`; never hard-code a provider call in React.
- Evidence citations must resolve to backend-validated Visit 1–9 source paths. Selecting a citation scrolls and highlights the matching timeline visit and trend point and can open the exact original JSON path.
- Generation motion must reflect persisted backend stages. Cancellation preserves a Cancelled run; retry creates a new run; an unfinished run becomes Interrupted after a process restart.
- Preserve source traceability: original upload, source filename, SHA-256, patient JSON path and reference visit must remain inspectable.
- The supplied Synthea-SG ZIP yields 369 valid cases, 33 truncated JSON files and 98 absent files. Never report all 402 present files as valid and never fabricate the 131 quarantined records.
- Study-mode fairness rule: an Admin pre-generates one Official Run per case. Doctors can see and score only that current locked answer; regenerating archives the prior official run and never mixes its assessments with the replacement.
- A Final Result is Admin-only and can be locked only after at least three distinct Doctors have submitted scores for the same Official Run. Drafts never aggregate; the equal-weight preset is recorded with the official answer before score review.
- Doctor context layout uses four simultaneous small-multiple trends (BP, HbA1c, eGFR, LDL) above a compact, selectable visit strip. Rule-based research signals may highlight source-backed changes, but must never be presented as clinical advice.
- The Doctor-facing evidence view is human-readable clinical-record format. Raw JSON is retained for Admin/development audit only.
- Admin evaluation review is doctor-first: Doctor → assessed case/official run → optional 2–4 detailed or 5+ matrix comparison of assessments for that exact Official Run. The clinician chatbot is deferred.
- The detailed Admin comparison uses 2–4 equal-width clinician cards in one horizontal board. Rubric, safety, clarification and case-feedback rows remain strictly aligned; clinician headers stay visible while scrolling; long feedback is collapsed on demand; score spreads of two or more are highlighted. Narrow viewports scroll horizontally instead of stacking cards.
- New Windows clones should be initialized through `First-Time-Setup.cmd` or `首次安装向导.cmd`. The wizard may write only Git-ignored local configuration/status files; it must never print, log, commit, or transmit an API key outside a requested model call.
- Doctor accounts use Active, Scoring suspended, and Deactivated states. Never delete a user or assessment; preserve audit history.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. The supported local runtime is `npm run build` followed by `npm start`; the Windows one-click path is `Start-Platform.cmd`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same frontend can still be packaged. Before handoff, run both `npm run build` and `npm test`.
