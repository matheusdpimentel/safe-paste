# Contributing to SafePaste

Use English for code, comments, technical documentation and contribution descriptions. Keep [README.md](README.md) in English and [README.pt-BR.md](README.pt-BR.md) in Brazilian Portuguese, with reciprocal links. Brazilian pattern names and fictional fixture values can remain Portuguese where needed for compatibility and coverage.

1. Read [AGENTS.md](AGENTS.md) and [adding detectors](docs/adding-detectors.md).
2. Use invented data only. Never submit real secrets or document contents.
3. Keep changes focused. Preserve `file://`, offline text processing, local file handling and the existing design.
4. Do not introduce telemetry, uploads, backends, production dependencies or network calls without an explicit maintainer decision. PDF.js is an existing on-demand exception.
5. Edit `src/index.html`, `src/` and the translation catalogs; regenerate the standalone HTML.

```bash
node build.mjs
node --test
```

For UI changes, run `npm run test:browser` with optional Playwright tooling, then check both languages, themes and narrow layouts. Browser tests use synthetic files, run against `file://`, and save temporary screenshots and generated PDFs. For an actual PDF.js integration check, run `REAL_PDF=1 npm run test:browser` with internet available. The standard browser suite mocks PDF.js for deterministic lifecycle tests.

For PDF changes, also run:

```bash
python -m unittest discover -s tests -p 'test_pdf_*.py' -v
```

Install optional Python dependencies from `tools/requirements-pdf.txt` in an isolated environment. Verify actual generated PDFs with an independent extractor and inspect rendered pages. Follow [PDF smoke checks](tests/pdf-browser-smoke.md); zero extracted text is not proof of complete coverage.

New detectors need positive, negative, overlap and progressive-typing cases. Preserve Brazilian rules in both UI languages and consider Python parity. New textual formats need validation, extension/MIME/download handling, tests and documentation.

Put every user-facing string in both catalogs; use message keys and interpolation rather than concatenating translated fragments. See [i18n](docs/i18n.md). Document any unsupported cases and validation limits in the pull request. Passing tests never establishes the absence of leaks.
