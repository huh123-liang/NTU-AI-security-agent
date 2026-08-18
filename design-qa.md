# MVP2 Design QA

- Source visual truth: `design-references/selected-safety-review-cockpit.png`
- Source pixel dimensions: 1440 × 1024
- Intended implementation viewport: 1440 × 1024 CSS pixels at deviceScaleFactor 1
- Intended state: Doctor Portal, completed DeepSeek run selected, six-dimension Safety Review Cockpit visible
- Current implementation URL: `http://127.0.0.1:4181/`
- Browser-rendered implementation screenshot: unavailable

## Full-view comparison evidence

The source visual was available and inspected. The current MVP2 implementation was built successfully, but the Codex in-app browser could not initialize because its `browser-service.mjs` dependency was rejected by the environment's trusted-code-path check. Therefore no current browser-rendered screenshot could be produced through the mandated browser surface.

The older files `design-qa-final.png`, `design-qa-focus-evaluation.png`, and `design-qa-comparison-final.png` belong to the earlier P0 implementation and are not valid evidence for MVP2.

## Focused comparison evidence

Unavailable for the same browser-connection reason. Code-level review confirms the intended three-column proportions, deep-navy sidebar, top workflow stepper, longitudinal timeline, model response panel, per-dimension 1–5 controls and feedback controls, but code inspection is not accepted as visual QA evidence.

## Findings

- [P0] Browser-rendered evidence is missing.
  - Location: complete MVP2 Doctor and Admin portals.
  - Evidence: the production build and HTTP API run, but no current screenshot can be captured through the in-app browser.
  - Impact: typography, spacing, overflow, focus states and visual fidelity cannot be formally certified.
  - Fix: obtain permission to use local Playwright for capture, or repair the Browser plugin trusted-path configuration; then test login, Doctor workspace, Admin aggregation, modals, console errors and the 1440 × 1024 layout.

## Required fidelity surfaces

- Fonts and typography: implemented with local Inter 400/500/600/700, but browser rendering remains unverified.
- Spacing and layout rhythm: CSS matches the reference's fixed sidebar and dense three-column cockpit, but browser rendering remains unverified.
- Colors and visual tokens: NTU-inspired navy/crimson and clinical semantic states are implemented without gradients; browser contrast remains unverified.
- Image quality and assets: the application relies on Phosphor UI icons and Recharts; no decorative raster placeholder is used. The official NTU logo is not bundled because an authorized asset was not provided.
- Copy and content: all product UI is English and labels data as synthetic/research-only; copy is implemented but browser wrapping remains unverified.

## Primary interactions verified outside the browser

- Admin and Doctor authentication via REST.
- Doctor registration.
- Dataset visibility and 369 valid case retrieval.
- Real DeepSeek run generation from visits 1–9.
- Three independent Doctor submissions.
- Admin weighted preview/finalization.
- Doctor peer privacy and HTTP 423 lock enforcement.
- Windows launcher start/health/stop.
- Production build and 7 automated tests.

## Comparison history

- MVP2 pass 1: blocked before visual comparison by the Browser plugin trusted-path error. No P0/P1/P2 visual fix loop could begin.

## Implementation checklist

1. Capture the unified login at 1440 × 1024.
2. Sign in as Doctor and capture the completed-run workspace.
3. Verify all navigation, score, feedback, raw-evidence and save controls.
4. Sign in as Admin and capture Overview, Evaluation Detail and Aggregation Studio.
5. Check console errors and overflow.
6. Compare source and implementation in one combined image; fix P0/P1/P2 findings and repeat.

final result: blocked
