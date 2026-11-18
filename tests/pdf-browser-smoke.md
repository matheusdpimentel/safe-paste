# Browser PDF manual smoke checks

Use synthetic PDFs only after changing PDF behavior or UI.

1. Open generated `index.html` directly in Chrome, then check offline text mode and both themes/languages.
2. Open **PDF**, load `examples/demo-original.pdf` using the real pinned PDF.js (internet required), and check page order and visible rectangles.
3. Visit every page. Export must remain blocked while any page is unviewed.
4. Draw/remove/redraw a manual rectangle; remove an automatic suggestion and restore it. Each edit must clear page-review confirmation.
5. Check warnings about removed suggestions. Switch PT/EN during review: labels, counters, removal tooltips and messages should change; rectangles, page visitation and confirmations should remain.
6. Check both confirmations and the final image-conversion dialog. Export, extract text independently (expected empty), and visually compare every rendered page with the original.
7. Test an image-only PDF: no automatic matches; manual rectangles still work. There is no OCR.
8. Test corrupt/password-protected files, over-25-MB files, over-30-page files, rotations and mixed layouts. Do not describe unreviewed output as protected with certainty.
9. Verify network activity: only PDF.js dependencies should be loaded; no document bytes should be uploaded.
10. Check `file://` and hosted use, plus Safari/Firefox before broad distribution. Record browser-specific limitations.

## Replacement regression

Replace an open PDF with another, repeat with the same filename, and try a corrupt document. Failures must leave the old file, rectangles and confirmations intact, with the error visible in the open panel. Successful replacement resets review for the new file. Resource cleanup uses `PDFDocumentLoadingTask.destroy()`, never an assumed proxy `destroy()`.

`npm run test:browser` covers mocked PDF lifecycle/export. `REAL_PDF=1 npm run test:browser` additionally covers the real library on a synthetic example. `tests/pdf-switch.browser.py` is a legacy optional Python/Playwright mock test. None of these replaces visual coverage review or establishes guaranteed anonymization.
