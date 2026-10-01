# Current project status / 当前进展

> Documentation reviewed against the local source on 1 October 2026. This is a capability summary, not a live database inventory or a claim of production certification.

[Project home](../../README.md) · [Architecture](../architecture/README.md) · [Developer handoff](../../PROJECT_STATUS_FOR_CLAUDE.md)

## Purpose

Collect independent clinician ratings and qualitative feedback on fixed AI responses, preserving source evidence and evaluation identity. These records support future **WP3 LLM Jury** research. The platform currently collects and governs evaluations; it does not itself train a jury model.

## Implemented

| Area | Completed capability |
| --- | --- |
| Login/accounts | Unified Doctor/Admin login, Doctor self-registration, hashed passwords/sessions, Admin account controls and sign-out |
| Persistent backend | Real local SQLite, source retention, run records, clinician scores, result locks and audit events |
| Dataset governance | Admin-only import; multi-table ZIP/CSV/CSV.GZ workflow; confirmed mapping, local preprocessing, quality report, quarantine and approval |
| Flexible tasks | One meaningful record is sufficient; single/short/standard longitudinal and undated task routing |
| Model registry | Versioned OpenAI-compatible configurations, encrypted local keys, model tags and Admin-confirmed routing |
| Official answers | Fixed model-specific batches, blinded Doctor labels, generation lifecycle, error display, cancellation/retry and replacement archival |
| Doctor workspace | Epic-inspired patient header, worklist, clinical navigator, chart views, four small-multiple trends, compact visit strip and evidence review |
| Human evaluation | Six fixed dimensions, optional feedback text/tags, drafts, editable unlocked submissions and peer isolation |
| Admin review | Doctor → assessed cases → exact-run comparisons; 2–4 aligned cards and larger comparison matrices |
| Final result | Mean/median/two-layer weighted aggregation, minimum three same-run submitted Doctors, recorded settings and locking |
| Local operation | First-time setup wizard, verified one-click start/stop, production frontend build and automated tests |

“OpenAI-compatible” means supported endpoint behavior, not guaranteed compatibility with every vendor feature or model. Available data, credentials, model versions and existing answers depend on each installation.

## Recent maintenance

- Doctor sign-out was retained in the compact clinical interface.
- Official Run creation was repaired using named SQL parameters instead of mismatched positional placeholders.
- Start errors use error styling; persisted provider failures remain inspectable.
- Incomplete token-limited responses are rejected. A new configuration/version can increase the output budget without changing prior evaluation settings.
- Repository navigation now separates current guidance from dated historical snapshots. Code entry points and one-click launcher locations remain unchanged.

See [CHANGELOG](../../CHANGELOG.md). Detailed generation settings and their limits are in the [engineering reference](../reference/engineering-details.md).

## Not yet completed / 后续方向

| Priority | Gap | Why it matters |
| --- | --- | --- |
| P0 | Semantic claim-to-evidence validation and calibrated clinical review criteria | A valid citation identifier alone does not prove a claim |
| P0 | Study export design, quality control and train/validation/test separation | Needed before using clinician records to train/evaluate LLM Jury |
| P1 | LLM Jury baseline, in-context learning/TextGrad experiments and held-out evaluation | Research goal; not an existing training feature |
| P1 | Structured clinician usability studies of the redesigned workspace | Epic-inspired appearance does not establish clinical usability |
| P1 | Stronger shared-server security, HTTPS, credential/admin policy, backup/recovery and worker architecture | Single-computer demo is not a production multi-user deployment |
| P2 | Actual Conductor/SIMFONI adapters if interfaces are supplied and scope is approved | Currently no interface contract/integration is implemented |
| Out of current scope | Epic embedding, ordering, prescribing or autonomous clinical decisions | The current requirement is an Epic-style review UI, not hospital-system integration |

Raw table discovery can suggest mappings; it is not a promise of fully automatic interpretation of arbitrary hospital schemas. New structures require review. Doctor peer privacy and local secret encryption are useful controls, not a completed compliance or penetration-test assessment.

## Data and verification notes

- The original supplied synthetic archive was assessed as **369 valid and 131 quarantined** records. This is archive-specific, not a guaranteed current case count.
- Local approved MIMIC-derived pilot data is separate from distributable code. Raw/derived patient data and clinician records remain in Git-ignored local storage.
- Tests use isolated/synthetic fixtures rather than transmitting real patient data. The original bundled-archive test may skip when that optional file is absent.
- Run `npm test` and `npm run build` for the checkout being reviewed; do not reuse historical test counts as current proof.
- Archived reports and PDFs describe earlier milestones. They are retained for reproducibility and should not override current behavior.
