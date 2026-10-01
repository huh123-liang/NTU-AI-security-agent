# Database schema / 数据库结构

[Project home](../README.md) · [Architecture](../docs/architecture/README.md)

[schema.sql](schema.sql) defines the **local SQLite tables**. The lifecycle and incremental schema checks are in [scripts/database.mjs](../scripts/database.mjs).

The real database file is `.data/platform.db`, created/maintained on the computer running the platform. It contains accounts, cases, model runs, assessments, model configurations and audit records. It is ignored by Git and must not be copied into this directory for sharing.

`migrations/` at the repository root belongs to the separate older hosting target; it is not a backup of the active local database. Review code and table definitions without publishing patient rows or credentials.
