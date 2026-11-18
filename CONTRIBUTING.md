# Contributing to SafePaste

Use English for code, comments, technical documentation and contribution descriptions. Keep [README.md](README.md) in English and [README.pt-BR.md](README.pt-BR.md) in Brazilian Portuguese, with reciprocal links. Brazilian pattern names and fictional fixture values can remain Portuguese where needed for compatibility and coverage.

1. Read [AGENTS.md](AGENTS.md) and [adding detectors](docs/adding-detectors.md).
2. Use invented data only. Never submit real secrets or document contents.
3. Keep changes focused. Preserve `file://`, offline text processing, local file handling and the existing design.
4. Do not introduce telemetry, uploads, backends, unreviewed dependencies or runtime network calls. The PDF.js distribution is local and pinned.
5. Edit `src/index.html`, `src/` and the translation catalogs; regenerate the standalone HTML.

```bash
node build.mjs
node --test
```

For UI changes, run `npm run test:browser` with Playwright and Chromium installed. The suite opens the app through `file://` with networking blocked and runs the real PDF.js against synthetic files. Install the independent verifier using `python -m pip install -r tests/requirements-pdf-security.txt` in a virtual environment. Set `PDF_TEST_PYTHON` to that Python executable if it differs from `python3`, `PLAYWRIGHT_MODULE` for an existing Playwright module, or `CHROME_BIN` to select Chrome. `PDF_TEST_OUTPUT_DIR` and `TEST_OUTPUT_DIR` override temporary output locations.

For PDF changes, also run:

```bash
python -m unittest discover -s tests -p 'test_pdf_*.py' -v
```

Set `PDF_TEST_ENGINE=firefox` or `PDF_TEST_ENGINE=webkit` with the matching Playwright browser installed to run `npm run test:pdf-security` on those engines. Playwright WebKit does not test the native Safari application. To generate an updated synthetic demonstration using the browser exporter, set `PDF_DEMO_OUTPUT` to a scratch path when running the Chromium PDF suite. Inspect the output before replacing `examples/demo-sanitizado.pdf`.

Install optional Python dependencies from `tools/requirements-pdf.txt` in an isolated environment. Verify actual generated PDFs with an independent extractor and inspect rendered pages. Follow [PDF smoke checks](tests/pdf-browser-smoke.md); zero extracted text is not proof of complete coverage.

New detectors need positive, negative, overlap and progressive-typing cases. Preserve Brazilian rules in both UI languages and consider Python parity. New textual formats need validation, extension/MIME/download handling, tests and documentation.

Put every user-facing string in both catalogs; use message keys and interpolation rather than concatenating translated fragments. See [i18n](docs/i18n.md). Document any unsupported cases and validation limits in the pull request. Passing tests never establishes the absence of leaks.
