# Developer / Claude review entry point

> Current documentation navigation: 1 October 2026. The former handoff is retained as a labelled [historical snapshot](docs/archive/claude-handoff-2026-09-15.md), not a current implementation specification.

Read these in order:

1. [README](README.md): purpose, setup, repository map and boundaries.
2. [Current project status](docs/project/STATUS.md): implemented capabilities, recent fixes and remaining work.
3. [Architecture](docs/architecture/README.md): active local runtime, module ownership and data flow.
4. [AGENTS.md](AGENTS.md): implementation constraints and confirmed product decisions.
5. [Backend module map](scripts/README.md) and [test map](tests/README.md): review entry points.

## Review priorities

- Authorization: Doctor-private scores and Admin-only dataset/model/result governance.
- Evaluation integrity: exact case, task, model version and output identity; immutable replacement/locking.
- Evidence semantics: source-path validation must not be confused with proof of clinical correctness.
- Data safety: raw hospital data stays local; preprocessing preserves lineage and does not fabricate critical values.
- Provider resilience: bounded failures, cancellation, retries, interrupted runs and truncated-output rejection.
- Operational readiness: shared-server security, recovery, backup and future PostgreSQL/worker migration.

The production-style **local** entry point is `scripts/serve.mjs`, not `worker/index.js`. Preserve all launchers and the separate legacy hosting build. Use `npm test` and `npm run build` before handing off changes. Never inspect or publish secret files or patient records merely to understand this codebase.
