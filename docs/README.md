# Documentation index / 文档目录

[Project home](../README.md) · [中文指南](../项目指南.md)

## Current guides / 当前优先阅读

| Section | Document | Audience |
| --- | --- | --- |
| Getting started | [Installation, launch and troubleshooting](getting-started/README.md) | Anyone trying the platform |
| Architecture | [System layers, source map and data flow](architecture/README.md) | Developers and researchers |
| Project progress | [Completed work, limitations and priorities](project/STATUS.md) | Supervisors and collaborators |
| Detailed reference | [Runtime, data/model rules and generation troubleshooting](reference/engineering-details.md) | Maintainers |
| Code review | [Claude/developer handoff](../PROJECT_STATUS_FOR_CLAUDE.md) | Reviewers |

Current guides describe repository behavior. Local database counts, provider credentials and generated answers vary by installation and are not part of a GitHub checkout.

## Historical material / 历史资料

The following are snapshots, not current setup instructions or claims about today's platform:

- [Earlier Chinese project guide](archive/project-guide-2026-09-15.md).
- [Earlier Claude handoff](archive/claude-handoff-2026-09-15.md).
- [Hospital dataset compatibility review — 2026-09-08](hosp-dataset-compatibility-2026-09-08.md).
- [Local MIMIC pilot implementation — 2026-09-08](mimic-hosp-pilot-implementation-2026-09-08.md).
- [MIMIC platform validation — 2026-09-15](mimic-hosp-platform-validation-2026-09-15.md).
- [Original bilingual project-plan PDF](AI_Medical_Agent_Evaluation_Platform_Project_Plan_Bilingual.pdf).

Older PDF-generation scripts remain here to preserve their existing paths. Generated reports in `output/` and design material in `design-references/` are also historical. Some locally removed historical assets may be unavailable; they are not prerequisites for running the platform.

## Maintenance rule

Update the current guides when behavior changes. Record previous behavior in [CHANGELOG](../CHANGELOG.md) or an explicitly dated archive. Do not embed patient-level records, clinician exports, credentials or workstation-specific runtime state in documentation.
