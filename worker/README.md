# Model adapter and legacy hosting target

[Project home](../README.md) · [Architecture](../docs/architecture/README.md)

These two files have different roles:

| File | Role |
| --- | --- |
| [model-adapter.js](model-adapter.js) | Shared model calls, task prompts, retry/error handling and incomplete-output rejection; used by the local backend |
| [index.js](index.js) | Separate legacy hosting API target retained for packaging compatibility |

The active full local MVP2 backend is [scripts/serve.mjs](../scripts/serve.mjs) + [scripts/local-api.mjs](../scripts/local-api.mjs), **not** this worker entry point. Do not infer a live cloud deployment or full Admin/Doctor feature parity from the presence of the legacy worker.

Model configuration and encrypted credentials belong to the [local registry](../scripts/model-registry.mjs), not browser code. The separate hosting build is produced by [prepare-sites-build.mjs](../scripts/prepare-sites-build.mjs); its compatibility is checked in [tests](../tests/README.md).
