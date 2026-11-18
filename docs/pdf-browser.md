# Browser PDF sanitization (experimental)

## Review flow

1. Open the generated `index.html`, including directly through `file://`.
2. Select **PDF · experimental** and a synthetic PDF up to 25 MB / 30 pages.
3. PDF.js loads from the existing pinned CDN URL; internet is required for this dependency. SafePaste passes local bytes through `getDocument({data: Uint8Array(...)})`, not an upload URL.
4. Review all pages. Drag to add manual rectangles; click **×** to remove any rectangle, including an automatic one.
5. **Undo last** removes the current page's last manual rectangle; **Clear manual** removes manual rectangles from all pages. **Restore automatic** restores all dismissed suggestions.
6. Confirm page review and image conversion, then export and accept the final conversion dialog.
7. Open the downloaded PDF and visually inspect every page before sharing.

Any rectangle/detector change clears the review confirmation. Removed automatic suggestions stay removed during recalculation through stable geometry keys. The exported file includes only active rectangles. Removing a suggestion may leave sensitive pixels visible.

## Architecture

- `src/pdf-mode.js` owns PDF loading, text extraction, preview, manual rectangle state and review/export gating.
- `src/sanitize.js` finds the same patterns used for text, including Brazilian phone numbers, addresses and CEPs regardless of UI language.
- PDF.js `getTextContent()` items are mapped to rectangles with conservative margins. A whole text run can be covered if only part matches. Unusual fonts, rotations, fragments and unsupported geometry can make positioning unreliable. Items that cannot be mapped may have no automatic rectangle.
- Export renders pages into canvases, paints **opaque black pixels** directly into the image, then passes JPEG pixels to `src/pdf-build.js`.
- `buildRasterPDF()` creates a new image-only PDF. Never reuse original PDF objects or replace pixel redactions with removable annotations.

Approximate appearance, orientation, page count and dimensions remain. Searchable/selectable text, text accessibility, links, forms, vector editing, annotations, attachments, original metadata and signatures do not. Image-only output may be larger; uncovered pixels can still be recognized by OCR elsewhere.

## Resource lifecycle and replacement

**Replace file** prepares the new document before discarding the previous document. Reading/rendering failure rolls back to the prior file, redactions and confirmations, displaying an error in the open review panel. Selecting the same file again is allowed.

Retain the `PDFDocumentLoadingTask` from `getDocument()`. Release it with `await task.destroy()` after a successful replacement, or release a failed new task. Do not assume `PDFDocumentProxy.destroy()` exists in every PDF.js version.

## Localization

Use `pdf.*` / `ui.pdf*` catalog keys for messages, progress, counters, tooltips, confirmation text and errors. Keep message keys/parameters rather than already translated strings so an in-progress or previous message updates when language changes. Third-party errors are mapped to safe messages; raw exception text may contain source information and is not displayed.

Language changes update labels and removal buttons only. They do not reload/render the PDF, recalculate candidates, discard rectangles, reset page visitation or invalidate confirmations. Filenames and imported content are not translated; only download naming changes.

## Privacy and unsupported cases

PDF.js and its worker are loaded on demand from `https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/`. This is an existing optional runtime dependency and executes third-party code in the browser. Offline PDF distribution requires a separate vendoring, license, integrity and CSP review. Text mode remains offline.

No OCR, face recognition, external analysis APIs, telemetry or content persistence. Scanned pages require manual redactions. Password-protected PDFs have no password entry flow. Names, images, unsupported geometry, free-form secrets and unrecognized patterns can be missed. **This is not guaranteed anonymization.**

## Verification

```bash
node build.mjs
node --test
npm run test:browser
REAL_PDF=1 npm run test:browser
```

Browser tests require optional Playwright/Chromium tooling. The default suite mocks PDF.js for deterministic progress, multi-page review, removal/restoration, failed replacement and export tests. `REAL_PDF=1` additionally reads `examples/demo-original.pdf` with the actual remote library through `file://` and exports it. Both languages are exercised. See [CONTRIBUTING.md](../CONTRIBUTING.md) for executable/module overrides.

Independently extract text from generated output and render it for visual inspection. No embedded text is expected, but an empty extraction does **not** prove all sensitive pixels were covered. Follow [manual smoke checks](../tests/pdf-browser-smoke.md) across target browsers. An optional legacy Python/Playwright replacement test also exists at `tests/pdf-switch.browser.py`; it mocks PDF.js and does not replace real-library checks.
