# Automated tests / 自动化验证

[Project home](../README.md) · [Architecture](../docs/architecture/README.md)

Run all tests from the repository root with `npm test`; run `npm run build` separately to verify frontend and packaging.

| Suite | Scope |
| --- | --- |
| [mvp2-core.test.mjs](mvp2-core.test.mjs) | Dataset quality, authentication helpers, evidence/tasks, aggregation/locking and Official Run creation/failure/retry/replacement |
| [hospital-ingestion.test.mjs](hospital-ingestion.test.mjs) | Multi-table discovery, mapping, preprocessing, adaptive eligibility, quarantine and approval |
| [setup-wizard.test.mjs](setup-wizard.test.mjs) | Windows installation/launcher contracts and secret handling |
| [sites-worker.test.mjs](sites-worker.test.mjs) | Separate legacy hosting-target compatibility |
| [repository-docs.test.mjs](repository-docs.test.mjs) | Current navigation targets exist, stay inside the repo and exclude private runtime files |

Core fixtures are isolated/synthetic; mocked provider tests do not require your real API key. The optional bundled-cohort test skips if its source ZIP is unavailable. A passing suite does not certify medical accuracy, hospital compliance or production security.
