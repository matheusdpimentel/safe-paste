# SafePaste security and privacy review

Review date: 2026-11-18. Baseline: `7dcc477`. Scope: the browser application, the PDF reader and writer, and dependency review for the separate experimental Python CLI. This is a focused engineering audit of the offline and export paths.

## Threat model

Treat all selected PDF bytes, embedded fonts, images, links, annotations, actions, form fields, metadata and attachments as untrusted. Treat a recipient of an exported PDF as able to read raw bytes, extract all objects and image streams, edit content and try OCR. Sensitive content includes source bytes, extracted text, temporary raster data, filenames and data the user meant to cover. Trust is placed in the authentic SafePaste HTML, its pinned code/assets, the current browser and the host OS. The release gates below are scoped to this model.

The trust boundaries run from the selected file into the PDF.js worker, from the renderer into the page canvas and from approved raster pixels into the output writer. The browser page holds the current preview and local review state. The network and browser persistence are outside the document flow.

## Findings and fixes

| Baseline or observed behavior | Change | Evidence |
| --- | --- | --- |
| The browser loaded PDF.js and its worker from a CDN. The CSP allowed connections to that origin. | Embed the display API, verified worker, fonts and decoding resources. Use a static resource table and disable network access in the CSP and worker adapter. | A standalone copy opened under `file://` with browser networking disabled and HTTP(S) routes aborted. No external requests, WebSockets or CSP violations were observed during the fixture run. |
| PDF.js could render annotation and form appearances by default. Some errors were logged as raw objects. | Render canvas only with annotations and XFA disabled. Exclude the viewer and scripting sandbox. Forward only a fixed worker failure signal and translated status codes. | The fixture includes an open action with a benign alert, external URI, form value and hidden content. No alert, request, input widget or source-derived console message appeared. |
| Preview and export used different scales and separate rectangle calculations. | Share viewport and integer mask geometry. Require a per-page raster digest match and write lossless RGB with opaque black mask pixels. | Each decompressed output image matches an independently composed RGB raster from the browser preview byte for byte. A changed second-page readback blocked download. |
| Real PDF.js could report a successful render after an operator stream error once the canvas had started drawing. | The build adapter emits a fixed failure signal before the upstream operator stream error. A worker warning also marks a session incomplete. | The oversized image fixture on page two reproduced the partial-success path before the fix. After the fix, navigation keeps the first preview and blocks confirmation and download. |
| Original PDF export already built a new file. It lacked independent structure and pixel regression tests. | Keep a minimal PDF object structure and replace JPEG with compressed RGB. Verify all pages before creating the download. | Two three-page exports passed strict object, stream, metadata, attachment, layer, text and decoded-pixel checks. Removing the drawing stream left a blank page. |
| Replacement retained document state on failure but there was no explicit close or processing cancellation. | Serialize operations, stage replacements, add cancellation and close, terminate owned workers and clear temporary canvases and byte buffers. | Invalid and password-protected replacement, chooser dismissal, canceled file read, same-file replacement and close were exercised. Workers started and terminated in equal numbers at the end. |

The single-file design keeps `file://` viable and avoids a local server or runtime package installation. A multi-file distribution with module workers would reduce the size of the initial HTML but adds file-origin and server configuration concerns. Browser offline emulation rejected the blob module worker during testing. The build converts the pinned worker into a classic blob script, with digest verification and no fake-worker fallback.

## Dependencies and notices

| Component | Pin and license |
| --- | --- |
| Mozilla PDF.js display API and parser worker | `pdfjs-dist@6.5.438`, Apache-2.0. Local digests and npm archive integrity are recorded in [integrity.json](../vendor/pdfjs/integrity.json). [Upstream tag](https://github.com/mozilla/pdf.js/releases/tag/v6.5.438). |
| Foxit standard fonts, Adobe CMaps and CMYK profile | From the same PDF.js release. PDFium redistribution notice, Adobe BSD-style redistribution terms and CC0 1.0 respectively. See `standard_fonts/LICENSE_FOXIT`, `cmaps/LICENSE` and `iccs/LICENSE` under `vendor/pdfjs/`. |
| OpenJPEG, JBIG2 and qcms | WASM binaries pinned by the same PDF.js archive. Retained notices cover the BSD-style OpenJPEG and PDFium components, MIT qcms, and Mozilla's Apache-2.0 adapters. See `vendor/pdfjs/wasm/LICENSE_*`. |
| Liberation Sans | Four font files from the official `2.1.5` binary release, SIL OFL 1.1. This substitutes the older GPL v2 with font exception `1.07.4` included in the PDF.js archive. The font and its matching license have separate archive and file digests. [Liberation Fonts release](https://github.com/liberationfonts/liberation-fonts/releases/tag/2.1.5), [Mozilla note on the upstream font](https://github.com/mozilla/pdf.js/pull/21750). |
| SafePaste writer and compression | First-party writer under the repository MIT license. Uses browser Canvas and Compression Streams. Requires no separate PDF generator package. |
| Optional Python CLI and independent verifier | pypdfium2 `5.15.2` (Apache-2.0/BSD-3-Clause plus native PDFium notices), Pillow `13.0.0` (MIT-CMU), ReportLab `5.1.0` (BSD), charset-normalizer `3.5.2` (MIT), pypdf `7.1.1` (BSD-3-Clause, verification only). The tested PDFium wheel identifies its native build as `159.0.8149.0@sourcebuild-toolchained`. |

Notices are retained in `vendor/pdfjs/` and included in the standalone HTML footer. Source PDF.js JavaScript files in the repository are unchanged. The build adapter changes worker asset loading, logging and operator-failure signaling and removes the worker's module export. The standalone artifact includes the font replacement described above. QuickJS scripting, the HTML viewer, the optional Node canvas dependency and source maps are outside the distribution.

Mozilla's [CVE-2024-4367](https://bugzilla.mozilla.org/show_bug.cgi?id=1893645) is fixed starting at `4.2.67`. [CVE-2026-16633](https://github.com/advisories/GHSA-hq66-cqwq-w95j) is fixed starting at `6.2.108`. The existing `6.5.438` pin is newer than both fixes and was retained. The browser path excludes the scripting sandbox and the CSP omits JavaScript string evaluation. The `wasm-unsafe-eval` allowance permits decoder compilation.

The CLI dependency ranges previously allowed older Pillow packages affected by advisories such as [CVE-2026-42310](https://github.com/python-pillow/Pillow/security/advisories/GHSA-r73j-pqj5-w3x7). This is a dependency observation, since the CLI uses PDFium for input PDF parsing. The updated Python pins were checked with `pip-audit` against the PyPI Advisory Database. No known vulnerabilities were returned for the listed pins on the review date. Native components and unreported flaws are outside that database result.

## Reproduce the evidence

Use only synthetic fixtures. The build requires Node.js and the checked-in assets. Browser integration requires Playwright and Chromium. The independent verifier requires Python 3.11 or later and the pinned test requirements. Package installation and advisory checks are maintenance operations that require network access. The application and test execution work offline once tools are installed.

```bash
node build.mjs
node --test
python -m pip install -r tests/requirements-pdf-security.txt
python -m unittest discover -s tests -p 'test_pdf_*.py' -v
PDF_TEST_PYTHON=python npm run test:browser
pip-audit -r tests/requirements-pdf-security.txt --no-deps --strict
```

The browser suite generates fixtures in a temporary directory. Set `PDF_TEST_OUTPUT_DIR` to retain a known location. The directory includes the standalone HTML copy, synthetic inputs, outputs, hashes, preview screenshots and independently rendered PNGs. Rerun only the extraction, object, decoded RGB and manipulation checks with:

```bash
python tests/pdf-security-fixtures.py verify /path/to/synthetic-test-output
```

| Check | Observed result |
| --- | --- |
| Node build and test suite | 47 passing tests. The CSP hash and the decompressed worker digest match the artifact. |
| Python CLI tests | 8 passing tests on Python 3.12 with the updated pins. They exercise the separate CLI and its existing geometry limits. |
| Text browser tests | 9 passing scenarios in Chrome 157.0.8103.79 with networking blocked. Includes import/download, copy fallback, PT/EN, themes, settings, invalid JSON and preference persistence. |
| Real PDF browser integration | Chrome 157.0.8103.79 on macOS, `file://`, network disabled. Covers digital text, scans, three pages, a 90° page, standard fonts, CMYK, an embedded JPEG 2000 image, hidden optional content, metadata, attachment, link, active form, scripted open action, encrypted/invalid inputs, navigation, review, replacement, cancellation and close. |
| Extraction and manipulation | pypdf strict parsing and PDFium extraction on 6 exported pages. Zero extractable text. The only image payload on each page contains the exact reviewed RGB pixels with solid black rectangles. The PDF object allowlist and blank-page test passed. |
| Visual check | Reviewed all three independently rendered pages. The digital and rotated text regions were covered in black, the manual mask covered the scan's marked region, and surrounding labels and color markers remained visible. |

## Residual risks

- Pattern recognition remains best-effort. Names, image content and unusual or fragmented text can remain visible. Available text geometry can still misrepresent glyph bounds. OCR of uncovered pixels can recover visible content. Always inspect the export.
- Complex fonts, optional content, color profiles and unusual encodings can change appearance, be omitted by the rendering policy or trigger a refusal. A warning and render-digest check cannot detect every deviation from the input's intended appearance.
- CPU and memory exhaustion remain possible before a timeout takes effect. Limits and worker termination reduce exposure. Canvas, browser internals, GC, swap, crashes, OS clipboard behavior and physical erasure are outside JavaScript's guarantees. App persistence is limited to theme/language. Explicit downloads are saved by the browser.
- A worker separates document processing and can be terminated. It is not a security boundary for a compromised browser, privileged extension or modified build. Keep the browser current. The verified worker digest binds payload to shipped controller, not publisher identity.
- The follow-up below adds Firefox and WebKit coverage on macOS. Native Safari, mobile browsers, broader document corpora and hosted response headers remain unverified. For hosting, use a matching response CSP with `frame-ancestors 'none'` when the hosting platform supports it. A meta CSP cannot set that directive.
- The optional Python CLI is a separate prototype with different validation and no browser review controls. Browser security checks do not establish equivalent CLI guarantees.

## Criteria for leaving experimental

1. Run a CI matrix on supported current Chromium, Firefox and WebKit/Safari targets, including standalone `file://` and one hosted build. Require zero unexpected network requests and identical reviewed/decoded export pixels on each target.
2. Extend synthetic coverage to page rotations 0/90/180/270, shifted crop boxes and `UserUnit`, CJK/vertical glyphs, transparency, malformed image/font streams, resource limits and cancellation during rendering and export. Every case must pass the object/pixel checks or be refused without a download.
3. Run repeated replacement and export under resource limits on desktop and a supported mobile target. Verify worker and canvas cleanup, document the measured maximum memory and time, and ensure no partial download on cancellation or failure.
4. Enforce vendored checksums and advisory checks in CI, review license provenance when files change and resolve any known applicable high or critical issue before a release.
5. Have an independent reviewer reproduce the offline, visual, object and pixel checks. Publish the supported environment and unsupported format matrix. Keep the experimental label until all gates pass.

## Follow-up to the independent review

- **SP-01.** Browser text downloads use `safepaste-protected` or `safepaste-protegido` and preserve only the validated extension. PDF names were already neutral. The browser tests verify both flows with synthetic input names containing ID-like and email-like values. Input names remain visible in the local review UI.
- **SP-02.** Overlap resolution now uses a prefix maximum tree in O(n log n) for n candidates, preserving the old priority, length and start ordering. On one local run, 8,000, 16,000 and 32,000 synthetic email matches took 163, 602 and 2,318 ms before the change and 13, 17 and 35 ms afterward. An additional comparison matched the previous implementation on 1,000 synthetic inputs. Detection still runs on the main thread.
- **SP-03.** The distributed `examples/demo-sanitizado.pdf` was regenerated by downloading the result of reviewing `examples/demo-original.pdf` in the browser UI. Independent inspection found a single RGB image, four opaque pixel masks, zero extractable text and no attached files or document metadata. A regression test checks the distributed binary.
- **SP-04.** Cross-toolchain compression reproducibility stays outside this round.

The follow-up passed 48 Node tests, 9 Python tests and 9 text-browser scenarios. The real PDF suite passed in Chrome 157.0.8103.79, Firefox 153.0 (Playwright build) and WebKit 26.5 (Playwright build) on macOS. Each run opened the isolated HTML via `file://`, emitted no observed external HTTP(S)/WebSocket requests, and independently verified six exported pages. Chrome and Firefox used offline emulation. WebKit used a closed loopback proxy and HTTP(S) interception because its offline emulation also rejects local file navigation. Native Safari 18.6 declined WebDriver setup while remote automation was disabled.

## macOS WebKit compatibility follow-up

The native macOS 15.7.4 `WKWebView` reproduced a generic PDF-open failure with the synthetic demonstration file. The pinned PDF.js calls map insertion methods that this engine lacks during parsing and rendering. The build now embeds compatibility code in the display module and worker and provides a local numeric fallback when `Math.sumPrecise` is unavailable.

The repaired standalone opened the same file in `WKWebView` and exported a page with four opaque pixel masks. Independent inspection found one RGB image and no extractable text, metadata, annotations or attachments. The rendered output was visually reviewed. The 49 Node tests, 9 Python tests and real PDF suites in Chrome, Firefox and Playwright WebKit passed. The WebKit suite ran with `PDF_TEST_LEGACY_APIS=1` to exercise the display fallback and found zero external requests. The Safari application's own open, review and download flow remains pending a manual check.

Cross-engine testing also led to two PDF reader adjustments. The worker starts after local file reading, so canceling that read leaves no parser worker to shut down. PDF.js renders font outlines to canvas without installing PDF-provided fonts into the HTML document. The network and CSP checks stayed enabled throughout the final runs.
