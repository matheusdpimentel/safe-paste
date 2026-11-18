# Refactoring review and possible improvements

Scope: the initial public release, interface internationalization and behavior-preserving simplification. This is an engineering review, not a security audit or a guarantee of complete sanitization. The project was reviewed before its first publication, so there was no prior commit history to assess.

## Changes implemented

| Change | Reason and behavioral boundary |
| --- | --- |
| Shared PT/EN catalogs and small `i18n.js` module | Removes interface strings from handlers without introducing a framework or translation service. Detection and replacements remain language-independent. |
| Separate `renderText()` from detector updates | Language switching updates labels/feedback while preserving textarea values, selection and detector state. |
| Keyed errors and PDF message state | Existing errors/progress can be translated during use. Known failures get localized messages; unknown third-party details use a generic message rather than exposing arbitrary exception text. |
| Editable `src/index.html` template | Makes generated output reproducible. The build embeds both catalogs, preserves offline text use and regenerates CSP hashes. |
| One dependency-ordered build pipeline | Replaces repeated per-file import/export stripping with one explicit list. No bundler or npm runtime dependency added. |
| English technical guides and two linked READMEs | Separates technical maintenance language from interface and Brazilian pattern coverage. |

`src/sanitize.js` changed only one comment. Rule patterns, priorities, overlap behavior, kinds and fictional replacement values were preserved. Text file and PDF builder validation retain the same acceptance rules; failures now carry translation keys. Download suffixes intentionally follow the selected UI language.

## Recommended next refactorings

| Priority | Area | Evidence and proposed scope |
| --- | --- | --- |
| High | PDF UI/state dependencies | `pdf-mode.js` reads editor/i18n/detector helpers from the concatenated script scope. Move initialization behind a controller with explicit dependencies, retaining lifecycle rollback, review gates and synthetic browser tests. |
| High | Preview rendering concurrency | `showPDFPage()` awaits rendering without using the existing `previewTask` slot or cancellation tokens. Rapid navigation/resize could race. Add a deterministic regression first, then serialize/cancel superseded preview work. This is separate from localization. |
| Medium | Detector/UI metadata | Category defaults, switches and display keys are maintained in different places. A small shared descriptor list could generate switches at build time, without moving regex rules or adding runtime complexity. Keep detector behavior tests independent. |
| Medium | Large text responsiveness | `update()` sanitizes synchronously on every input; overlap checks scan accepted candidates. The import limit is 5 MB, but there are no performance budgets. Benchmark synthetic worst cases first; then consider a worker with revision tokens if measurements justify it. |
| Medium | Delivery automation | Add CI for Node tests, deterministic build checks and optional browser/Python PDF checks. Choose and document supported runtime versions first. |
| Low | Styling and unused PDF state | `styles.css` mixes long compressed rules with readable blocks; `manualMode`/`previewTask` and some element lookups are unused. Reformat/remove dead fields in a separate small patch after behavior coverage. |

Avoid a framework migration or large detector rewrite solely for aesthetics. The current pure detector/file helpers and standalone distribution are useful boundaries to preserve.

## Possible new functions (not implemented)

1. **Manual text redaction:** let users select and replace an unrecognized segment while retaining review warnings. Highest product value for names and contextual secrets outside regex coverage; requires decisions about edits, offsets and undo.
2. **PDF undo/redo:** keep a local in-memory history for adding/removing/restoring rectangles; invalidate review after each history operation. Never persist document contents.
3. **Audited offline PDF distribution:** implemented after this initial review. See the [security report](security-audit.md) for current evidence and remaining release criteria.
4. **Additional locale-specific patterns:** only after separate coverage decisions and synthetic positive/negative/overlap tests. Selecting English should never silently disable Brazilian patterns or imply global personal-data coverage.

OCR, automatic external translation and cloud document analysis are intentionally outside this implementation. OCR needs an explicit privacy design and approval.

## Initial release validation (historical)

- Baseline: 39 existing Node tests passed before changes.
- Updated suite: 47 Node tests, including language detection, persistence, storage denial, catalog/placeholder parity, dynamic errors, naming and standalone CSP validation.
- Python PDF suite: 8 tests passed with optional dependencies available.
- Chrome browser suite: 14 scenarios passed on `file://`, including offline text, PT/EN state preservation, imports/downloads, clipboard success/fallback, sharing guards, storage behavior, narrow layout, deterministic PDF lifecycle and actual PDF.js import/export.
- Three generated exports (two mocked documents and one real PDF.js example) were independently opened with pypdf and PDFium: five pages total, no extractable text. All five pages were rendered and visually inspected; the real example retained layout with black pixel redactions over recognized values.
- PT/EN light/dark desktop and Portuguese mobile screenshots were inspected. Safari, Firefox, hosted deployment, large-file performance and adversarial/unusual PDF layouts remain unverified in this session.

These checks establish that the initial outputs contain no selectable text. For current offline and raster verification, see the [security report](security-audit.md).

## Initial release changed-file inventory (historical)

- Runtime/build: `build.mjs`, `package.json`, generated `index.html`, `src/app.js`, `src/pdf-mode.js`, `src/pdf-build.js`, `src/text-files.js`, `src/styles.css`, and a comment-only edit in `src/sanitize.js`.
- New sources: `src/index.html`, `src/i18n.js`, `src/locales/en-US.js`, `src/locales/pt-BR.js`.
- Documentation: `README.md`, new `README.pt-BR.md`, new `CONTRIBUTING.md`, `AGENTS.md`, `docs/adding-detectors.md`, `docs/pdf-browser.md`, `docs/pdf-redaction.md`, `docs/text-files.md`, `docs/ai-workflow.md`, new `docs/i18n.md` and this review.
- Validation: new `tests/i18n.test.js`, new `tests/i18n.browser.mjs`, updated `tests/text-files.test.js`, `tests/pdf-build.test.js`, `tests/pdf-switch.browser.py`, `tests/pdf-browser-smoke.md`.

The legacy Python/Playwright browser script was updated for the explicit Portuguese locale, stable localized PDF errors and configurable Chrome executable. It was not executed because the Python Playwright package was unavailable; the Node/Playwright browser suite exercised the same replacement/resource-cleanup scenarios. No production dependency was installed or changed.
