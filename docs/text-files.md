# TXT, JSON and Markdown files

SafePaste imports files using the browser's local `File` API. It does not upload bytes or execute imported content. The same `sanitize()` handles pasted and imported text.

## Data flow

1. **Import file** selects `.txt`, `.json` or `.md`.
2. `inspectTextFile()` checks the extension and 5 MB limit.
3. `file.arrayBuffer()` reads bytes; `decodeTextBuffer()` decodes strict UTF-8, strips a BOM and rejects binary control characters.
4. `validateJsonFile()` checks JSON syntax when applicable.
5. The text editor displays the original; the shared detector generates highlights and protected output. The original disk file remains untouched.
6. **Download protected** creates a local `Blob` and requests a new download. Extensions are retained; the suffix follows the UI language (`-protected` / `-protegido`).

Markdown is plain text: no HTML rendering or script execution. Regex substitutions may affect code blocks. JSON textual formatting/order are retained when replacements permit it. If protected JSON becomes invalid, both copy and download remain blocked until corrected. Syntax validation is not schema validation or guaranteed removal of sensitive information.

`src/text-files.js` contains pure helpers; `src/app.js` owns browser state. Validation errors use stable `LocalizedError` keys, translated at display time, including after a language change. Existing helper callers retain Portuguese default download suffixes; the interface passes localized naming options explicitly.

## Add a text format

1. Confirm it is UTF-8 text, not a binary container such as DOCX.
2. Extend `TEXT_FILE_EXTENSIONS` in `src/text-files.js`.
3. Update `#text-file` `accept` in **`src/index.html`**.
4. Define the download MIME in `src/app.js`.
5. Add input/output syntax validation if needed.
6. Add invented fixtures for accents, sensitive values, formatting, oversized/invalid files and safe filenames.
7. Update both READMEs and both translation catalogs where relevant.
8. Run `node build.mjs`, `node --test` and the optional browser suite. Check direct `file://` import, editing, copy and download in both languages.

Do not edit only generated HTML scripts. Do not add network calls to sanitize bytes.

## Limits and privacy

Only UTF-8 files up to 5 MB are supported. Convert UTF-16/Latin-1 before import. There is no directory processing or DOCX/XLSX conversion. PDF has a separate experimental mode.

Only theme and manual language preferences are stored; neither content nor detection choices are persisted. Language switching preserves current content and imported filenames. Unknown names, comments, identifiers and contextual secrets may remain: always review output.
