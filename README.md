# SafePaste

**English** | [Português (Brasil)](README.pt-BR.md)

A local-first, best-effort sanitizer for text, TXT/JSON/Markdown files and experimental PDF redaction. Review sensitive information before sharing it with AI tools or other people. Static application, no backend.

## Use without installation

1. Download **only `index.html`**.
2. Open it in a modern browser, including directly through `file://`.
3. Paste text or import `.txt`, `.json` or `.md` in **Text and code**. Review the highlights and protected output before copying or downloading.
4. For PDFs, open **PDF · experimental**, review every page and export a new image-only document.

No Node.js, Python, extensions or local server are required to use the app. **Text mode works offline.** PDF mode requires internet to load the existing, version-pinned PDF.js dependency from jsDelivr. SafePaste processes document bytes locally; it does not upload them. Remote libraries execute with access to the page, so their provider must be trusted.

The generated `index.html` can also be hosted on GitHub Pages: Settings → Pages → Deploy from a branch → main → root. Keep the generated HTML in the published root.

## Features

- Highlight recognized sensitive segments and replace them with fictional values.
- Import UTF-8 TXT, JSON and Markdown files up to **5 MB**; edit and download with the original extension. Original files are never modified.
- Validate input JSON and protected JSON. Copy/download are blocked if replacements produce invalid JSON.
- Use examples, clear the editor, copy protected text or download it.
- Choose light/dark theme and **PT | EN** beside the theme control.
- On the first visit, detect Portuguese/English from browser language preferences; fall back to English. Save only explicit language choices and the theme in `localStorage`.
- Configure **13 independent detection categories** in a panel that starts collapsed, with all categories enabled on every page load.
- Review PDFs up to **25 MB and 30 pages**, add/remove manual and automatic redactions, and export a new image-only PDF after mandatory review and conversion confirmation.

Switching the interface language preserves editor contents, settings, theme, PDF redactions and review confirmations. It changes interface messages and download suffixes (`-protected` / `-protegido`). **Brazilian detection rules and fictional replacement values stay the same in both languages.** Imported content is never translated.

## Text files

Select **Import file**, review the protected output, then choose **Download protected**. A file such as `config.json` becomes `config-protected.json` in English or `config-protegido.json` in Portuguese. Pasted text downloads as `safepaste-protected.txt` / `safepaste-protegido.txt`.

Markdown stays plain text: headings, code fences and lists are not executed or rendered as HTML. JSON formatting and textual order are retained when substitutions permit it. JSON validation checks syntax, not a schema or the absence of sensitive information. Invalid input, binary files, unsupported extensions, invalid UTF-8 and files above the size limit are rejected. There is no directory processing or DOCX/XLSX conversion.

**Clear all** removes the visible content and imported file association. Content stays in memory while the page is open and is not saved in browser storage. Downloads start only when requested. See [text file development](docs/text-files.md).

## Detection coverage

Open **What to detect** to adjust:

- **Credentials and access:** variable assignments, known token prefixes, Bearer headers, JWTs, private key blocks and URL credentials.
- **Personal data:** Brazilian CPF, CNPJ, emails, phone numbers, addresses and postal codes (CEP).
- **Infrastructure and IDs:** IPv4 and UUIDs.

All rules start enabled on each load; detection settings are not persisted. **Enable all** restores defaults. Overlapping rules can still conceal a value after one category is disabled. Copy and download are blocked when all categories are off or a labeled CPF is still incomplete.

CPF accepts complete punctuated forms and unformatted 11-digit sequences, including fictional invalid checksums; this can create false positives. CNPJ supports formatted forms and unformatted values recognized by checksum or a `CNPJ` label. Assignment detection handles names such as `apitoken`, `api_token`, `apiToken`, `API_KEY` and `PASSWORD`, replacing values rather than variable names.

Phones include recognized Brazilian mobile, landline, DDD, `+55` and `0800` formats. An unlabeled 11-digit number can be ambiguous with CPF and may receive an unexpected classification while still being concealed. Addresses include labeled fields, common Brazilian street prefixes with house numbers, same-line complements and formatted/labeled CEPs. Multiline addresses, neighborhoods/cities alone, uncommon formats and other languages may be missed. Names, faces, free-form secrets and contextual personal data are outside reliable pattern coverage.

Browser PDFs use the same JavaScript detector as text mode. The Python CLI has separate equivalent rules; do not assume complete parity without comparative tests. Read [adding detectors](docs/adding-detectors.md).

## Experimental browser PDF

1. Select **PDF · experimental**, then **Choose PDF**.
2. Review **every page**. Detection uses extractable text; **there is no OCR**.
3. Drag to add a rectangle. Use **×** to remove any rectangle, including automatic suggestions. **Restore automatic** restores discarded suggestions; **Clear manual** removes all manual rectangles.
4. Confirm page review and conversion to image pages.
5. Choose **Generate redacted PDF**, accept the conversion dialog, then open and visually inspect the downloaded PDF.

Redactions are painted as opaque black pixels into rendered images. The output is an entirely new PDF: original PDF objects, hidden text, attachments, forms, links, metadata and digital signatures are not copied. Page appearance, order and dimensions are approximately retained. Selectable/searchable text and text accessibility are lost, and file size can increase.

Automatic detection and geometry mapping can miss or misplace redactions, especially with unusual fonts, rotations, fragmented text or images. Scanned documents require manual rectangles. **No extractable text in the output does not prove every sensitive pixel was covered.**

**Replace file** loads the new PDF before discarding the previous one. If reading or preview rendering fails, the previous document and its review state remain available. The same filename may be selected again.

See [browser PDF architecture and testing](docs/pdf-browser.md), [manual smoke checks](tests/pdf-browser-smoke.md) and the independent [Python CLI](docs/pdf-redaction.md). The synthetic examples include `demo-original.pdf`, `demo-sanitizado.pdf` and `telefone-endereco-original.pdf`. All example data is invented.

## Development

Node.js is needed only for development/builds. No npm packages are required for the build or Node tests:

```bash
node build.mjs
node --test
```

Edit sources, then regenerate `index.html`. **Do not edit its embedded JavaScript or CSS.** The build embeds both translation catalogs and recomputes CSP hashes without adding network requests.

| Path | Purpose |
| --- | --- |
| `src/index.html` | Editable interface template |
| `src/locales/en-US.js`, `src/locales/pt-BR.js` | Translation catalogs |
| `src/i18n.js` | Language selection, safe storage, interpolation and UI translation |
| `src/sanitize.js` | Pure detection and replacement rules |
| `src/app.js` | Text editor, theme, file import/copy/download |
| `src/text-files.js` | File validation, decoding, JSON checks and safe filenames |
| `src/pdf-mode.js` | PDF loading, preview and redaction review |
| `src/pdf-build.js` | New image-only PDF generation |
| `src/styles.css` | Shared light/dark styles |
| `tests/`, `docs/`, `tools/` | Regressions, technical guides and optional Python CLI |

The editor keeps textarea text visible; the highlight layer provides background color only. Regression tests check this in both themes.

Browser integration tests are optional development tooling. With Playwright and its Chromium installed:

```bash
npm run test:browser
# Also exercise the version-pinned remote PDF.js (requires internet):
REAL_PDF=1 npm run test:browser
```

`PLAYWRIGHT_MODULE` can point to an existing Playwright module, `CHROME_BIN` to a Chrome executable and `TEST_OUTPUT_DIR` to a temporary artifact directory. See [CONTRIBUTING.md](CONTRIBUTING.md), [internationalization](docs/i18n.md), [AI workflow](docs/ai-workflow.md) and [refactoring review and future improvements](docs/refactoring-review.md). Coding agents should follow [AGENTS.md](AGENTS.md). Technical documentation is maintained in English.

## Privacy and limitations

- SafePaste is **best-effort**, not guaranteed anonymization. Review all output before sharing.
- No telemetry, backend, translation APIs or content uploads. Only theme and manual language preferences are stored.
- Browser storage may be blocked, particularly in private browsing or under `file://`; language switching still works for the current page. Persistence on local files depends on the browser.
- PDF.js and its worker are fetched on demand from an existing pinned CDN URL. Text mode needs no network. Vendoring PDF.js requires a separate license/CSP review and distribution decision.
- No automatic OCR, image recognition, multilingual detection expansion or comprehensive security audit.
- Never include real secrets in issues, screenshots, examples, tests or commits. If a real credential was exposed, revoke/rotate it; sanitizing later does not undo exposure.

MIT license.
