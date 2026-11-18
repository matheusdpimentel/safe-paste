# Browser PDF redaction (experimental)

Download and open the generated `index.html` in a current browser. The file includes PDF.js, its worker, fonts and image resources. The same file works offline, including through `file://`. Chrome is the tested browser for this release.

## Review and export

1. Choose **PDF · experimental**, then select a PDF up to 25 MB and 30 pages.
2. Review every page. Drag to draw a manual rectangle. Click **×** to remove a rectangle. **Undo last** removes the last manual rectangle on this page, **Clear manual** clears manual rectangles, and **Restore automatic** restores dismissed suggestions.
3. Confirm review and conversion to images. There is no OCR. A scan without text can be covered manually. Export requires at least one rectangle somewhere in the document.
4. Accept the final confirmation and open the downloaded PDF. Verify that every sensitive region is covered.

Changing a rectangle clears the review confirmation. Changing detector settings requires revisiting the other pages. Removing an automatic suggestion can leave the corresponding data visible. Switching the interface language preserves rectangles and confirmations.

The output preserves page order and visible dimensions. Rotation is baked into the new image. Rasterization can change colors, fonts or fine details. Interactive forms, annotations, links, signatures and text accessibility are excluded. Search and text selection are lost. The generated file can be larger.

## Offline boundary

`build.mjs` incorporates the PDF.js display API and a compressed worker payload from verified local assets. `src/pdf-offline.js` verifies the worker digest before creating a classic blob worker. Each document has its own worker. Embedded asset lookup in `tools/embed-pdfjs.mjs` resolves CMaps, fonts, ICC data and decoders by exact name. Missing assets do not fall back to network sources. The CSP blocks network connections and authorizes only the hashed scripts, WebAssembly compilation, local blob workers and embedded font/image resources.

The worker receives file bytes after local reading succeeds. The display API renders only into a canvas, with annotation rendering and XFA disabled. Fonts are drawn as outlines to avoid installing PDF-provided fonts in the HTML document. SafePaste does not install the PDF.js viewer, scripting sandbox, link handlers, text layer or form UI. Worker warnings and operator stream failures become a fixed signal to block the PDF. The UI surfaces translated codes and does not log raw exception messages.

## Reviewed pixels and lifecycle

- The preview and exporter use the same viewport transform, raster dimensions and integer rectangles. CSS scales the display only. Automatic boxes can conservatively cover whole text runs. An unmapped recognized value blocks export.
- After successful preview rendering, the application records a SHA-256 digest of that page's raster. Export snapshots approved rectangles and rerenders each page. It compares geometry and pixels, paints opaque black into the pixels and compresses the RGB result without loss. It starts a download only after every page succeeds.
- The writer emits a new catalog, page tree and three objects per page: page, image and drawing stream. The drawing stream places the new image. It contains no source object references.
- **Replace file** retains the previous PDF until the candidate's first preview succeeds. Invalid input, password protection or a canceled replacement leaves the previous review intact. Processing is serialized. **Cancel operation** interrupts the current operation and discards partial output. **Close PDF** drops working references, terminates the worker and clears the canvases. JavaScript cannot guarantee physical erasure of memory.
- Limits include 25 MiB input, 30 pages, 6,000 points per side, approximately five million output pixels per page, 24 million pixels per source image, 500,000 extracted characters, 50,000 text segments, 80 MiB output and operation timeouts. Complex or damaged files may be refused.

See the [security report](security-audit.md) for the threat model, reproducible tests, dependency licenses and criteria for removing the experimental label.
