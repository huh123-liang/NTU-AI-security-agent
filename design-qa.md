# MVP2 Design QA — Epic-style Doctor Portal

## Comparison target

- Source visual truth: UPenn *Exploring Epic and Carelign* training video, Visit Report at `06:11` and Summary/Chart Review at `03:11` (`https://bcove.video/3Qe3uC2`).
- Product-direction reference: `C:\Users\Lenovo\AppData\Local\Temp\codex-clipboard-f0e3df4a-bd88-4eee-8020-d086165d0e2b.png`.
- Rendered implementation: `http://127.0.0.1:4180/#/workspace/CASE-9A452BC7D5E741399A`.
- Implementation screenshot path: Codex in-app browser capture, tab `4`, retained as the visible deliverable for this task.
- Verification date: 29 September 2026.
- Viewport: 1280 × 720 CSS pixels, device scale factor 1.
- Source pixels: 1280 × 720 browser capture. Implementation pixels: 1280 × 720 browser capture. No density resampling was required.
- State: authenticated Doctor `123`, de-identified MIMIC case `MIMIC-HOSP-0001891D86`, fixed completed Official Run, no assessment submitted.

## Full-view comparison evidence

The source and implementation were captured and viewed together in one comparison pass at the same 1280 × 720 viewport. The implementation carries over the clinically important Epic patterns without copying Epic branding: a persistent patient context, compact blue clinical navigation, dense tabular longitudinal data, low-radius bordered panels, small typography, and contextual review panes. The product-specific Evidence and Evaluation functions remain in the right sidecar so the existing research workflow is preserved.

Intentional differences:

- NTU branding and the existing navy/crimson research identity are retained; no Epic logos or copyrighted assets are reproduced.
- The source's ordering, prescribing, discharge, and other hospital-operational controls are omitted because this platform is an evaluation tool.
- The implementation uses a fixed top patient banner rather than exposing identifiable hospital demographics in a left Epic rail.
- AI Response, source evidence, and the six-dimension clinician rubric are product requirements that do not appear in the source Epic screen.

## Focused region comparison evidence

- Patient context: verified fixed patient ID, age, sex, allergy status, cohort, Official Run status, and review progress.
- Clinical navigation and flowsheet: verified Patient Summary, Chart Review, Labs, Medications, Diagnoses, Documents, and Source Record; Chart Review and Labs render visit-by-measure tables with missing cells left blank.
- Evidence traceability: clicking `V1 · Systolic blood pressure` switched the right sidecar to Evidence, highlighted BP and Visit 1 in the centre pane, and opened a human-readable Clinical record trace dialog.
- Evaluation: verified six independently collapsible dimensions, 1–5 controls, preset tags, custom tag input, free-text feedback, safety checks, and sticky Save/Submit actions.
- Language: verified English default and Chinese navigation/context toggle without changing case or assessment state.
- Worklist: verified dataset filtering, search, readiness/status filters, Official Run status, and current doctor's assessment status only.

## Required fidelity surfaces

- Fonts and typography: Inter is used consistently; compact 6.5–14 px UI hierarchy matches the dense clinical reference while preserving readable body text in the AI pane. Long identifiers now use deliberate ellipsis with full-value titles.
- Spacing and layout rhythm: 72 px icon rail, 112 px patient/progress header, 160 px clinical navigator, flexible clinical centre, and 380 px review sidecar produce a stable dense desktop grid. Borders, 2–6 px radii, and minimal elevation align with the clinical reference.
- Colors and tokens: pale clinical blue, white, navy, green status, amber allergy alert, and restrained NTU crimson are semantically consistent and maintain visible contrast.
- Image quality and asset fidelity: the target contains no required product imagery. The implementation uses one consistent Phosphor icon family and no emoji, placeholder illustrations, CSS drawings, or copied Epic assets.
- Copy and content: UI copy distinguishes de-identified research records, fixed Official Runs, source-backed evidence, missing measurements, and editable-until-lock assessments. Model identity is blinded as `Model A` for Doctors.

## Comparison history

### Iteration 1 — blocked

- [P2] Narrow-rail feedback label wrapped beside its icon.
  - Fix: visually hid the label in Doctor mode while preserving its accessible button name; normalized the icon to 18 px.
- [P2] `available source metrics` could imply that absent HbA1c/eGFR/LDL series existed.
  - Fix: changed the summary to `4 monitored metrics`; missing series explicitly render `No source series` and are never reconstructed.
- [P2] Long patient IDs in the summary card were clipped unpredictably by the record-status badge.
  - Fix: added flex constraints, deliberate ellipsis, and a full-value title on patient IDs; added a title to truncated allergy text.

### Iteration 2 — passed

- Post-fix browser capture confirmed a clean 72 px rail, accurate missing-data copy, and stable ellipsis with no overlap.
- Evidence, Evaluation, Chart Review, Labs, Source Record, and language interactions remained functional after the fixes.
- Browser console check: 0 warnings, 0 errors.
- `npm.cmd run build`: passed.
- `npm.cmd test`: 17 passed, 0 failed, 1 intentionally skipped because the optional source ZIP is absent from the working tree.

## Findings

- P0: none.
- P1: none.
- P2: none after Iteration 2.
- P3: the Chinese toggle localizes the clinician navigation and patient-context shell; source clinical terminology and AI output remain in their original English to avoid altering evidence-bearing content.

## Residual test gaps

- Mobile layout was not tested because the agreed target is desktop/laptop at 1366–1920 px and the product is not intended for mobile review.
- Hover tooltips for deliberately truncated text were checked through title attributes rather than pointer capture.

final result: passed
