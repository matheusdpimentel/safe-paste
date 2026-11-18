# Instructions for development agents

SafePaste is a local-first tool for **best-effort** sanitization, not a system that guarantees anonymization. Never promise complete coverage.

## Before changing code

1. Read `README.md` and `docs/adding-detectors.md`.
2. Use invented data only in examples, tests and commits.
3. Preserve offline text and PDF processing in the standalone `index.html`, including `file://`.
4. Do **not** add telemetry, network calls, CDNs, backends or production dependencies without an explicit maintainer decision.
5. Use English for code, comments and technical documentation. Maintain both READMEs and both translation catalogs when relevant. Brazilian patterns and legacy detector labels remain compatible across UI languages.

## Detection changes

- Change `src/sanitize.js`; never edit only the embedded JavaScript in `index.html`.
- Update options and `data-detector` controls in `src/index.html` when adding/removing a category.
- Add positive, negative, overlap and progressive-typing tests under `tests/`.
- Exercise realistic **synthetic** logs: `Erro: apitoken=SEGREDO_FICTICIO_123`, JSON, `.env`, database links, and CPF with/without punctuation.
- Consider parity with `tools/pdf_rules.py` and document differences when a rule applies to PDF.
- Run `node build.mjs && node --test`; for PDF changes, also run `python -m unittest discover -s tests -p 'test_pdf_*.py' -v`.

## PDF changes

- Read `docs/pdf-redaction.md`.
- Never replace redactions incorporated into image pixels with removable rectangle overlays.
- Do not copy original PDF objects into the output: metadata, attachments, hidden text and forms can be dangerous.
- Fail closed when geometry or text cannot be safely mapped.
- Verify no extractable text in generated documents **and** inspect rendered output.
- Do not implement automatic OCR or send documents to external APIs without explicit approval and a privacy design.

## User responses and pull requests

Explain changes, limitations, tests run and remaining unsupported cases. Passing tests is not a guarantee against leaks.

## Browser PDF mode

- `src/pdf-mode.js` manages PDF.js reading, `sanitize()` detection and manual redactions.
- `src/pdf-build.js` creates a new image-only PDF; never copy original objects.
- Preserve image conversion confirmation and review of every page. Pattern detection is not guaranteed anonymization.
- PDF.js and assets are pinned in `vendor/pdfjs`. Build verifies SHA-256 digests and embeds all resources. Keep `connect-src 'none'`, static asset lookup, isolated worker processing and stable error keys. Preserve the license notices and rerun the advisory review when updating dependencies.
- Keep approval and export tied to the same integer pixel rectangles and verified render. Block failed operations and discard partial output.
- After JavaScript or CSS changes, run `node build.mjs`, `node --test`, and verify actual PDF generation and absence of extractable text.
- Run `npm run test:pdf-security` for PDF changes and inspect the resulting synthetic PDFs. See `docs/security-audit.md`.

## TXT, JSON and Markdown

- Files selected through `#text-file` are processed locally; never add `fetch`/uploads to sanitize imported bytes.
- Pure extension, size, strict UTF-8, JSON and download naming helpers live in `src/text-files.js`; browser flow lives in `src/app.js`.
- New formats require extension allowlists, HTML `accept`, download logic, file tests and `docs/text-files.md`. Never execute imported content.
- Preserve copy/download blocking for invalid protected JSON. Never modify original files.
- Run `node build.mjs` and `node --test`, then check browser import/download.

## Internationalization and build

- Edit interface markup in `src/index.html`; `index.html` is generated.
- Keep translations in `src/locales/en-US.js` and `src/locales/pt-BR.js`; use `src/i18n.js` without fetching translations.
- Persist only theme/manual language preferences, never content or detection choices.
- Language changes must preserve text, settings, PDF redactions and review state. Do not change Brazilian rules or replacement values based on UI language.
- Run language unit tests and optional `npm run test:browser` integration tests; see `docs/i18n.md`.
