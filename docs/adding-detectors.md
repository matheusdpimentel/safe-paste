# Adding detection patterns

SafePaste runs locally without a backend or AI model. Each rule has an option, a pattern, a fictional replacement, a priority and regression tests. Coverage is always best-effort.

## Prepare and understand the sources

```bash
node --version
node build.mjs
node --test
```

Node.js is needed for development only. No npm dependencies are required for these commands.

| Source | Responsibility |
| --- | --- |
| `src/sanitize.js` | Pure detection, overlap resolution and replacements |
| `src/index.html` | Interface template and `data-detector` switches |
| `src/app.js` | Controls, highlights, statuses and sharing guards |
| `src/locales/` | English and Portuguese interface messages |
| `src/pdf-mode.js` | Map shared JavaScript hits to browser PDF rectangles |
| `tools/pdf_rules.py` | Independent rules for the optional Python PDF CLI |
| `build.mjs` | Embed sources/catalogs and regenerate CSP hashes |

Never edit only the embedded JavaScript in `index.html`. Edit sources and regenerate the distribution artifact.

## Add a rule

1. Add a default-enabled option in `DEFAULT_DETECTIONS`.
2. Inside `sanitize()`, guard the new rule with that option.
3. Use `add(regex, kind, replacement, priority)` or `addHit(start, end, kind, replacement, priority)` for precise value-only matches.
4. Add a matching switch in `src/index.html`, including `data-detector`, `id="det-…"`, `checked`, accessible labeling and the existing switch classes.
5. Add its name/description and display category to both translation catalogs. Existing `hit.kind` labels are preserved for compatibility and localized through `kind.*` keys; never use the current UI language inside detection rules.
6. Update category fixtures/counts in `tests/detection-options.test.js` and documentation when categories change. There are currently 13 categories.

For illustration, a standalone postal-code rule could use:

```js
if (settings.examplePostalCode) {
  add(/(?<!\d)\d{5}-\d{3}(?!\d)/g, 'Example postal codes', '00000-000', 25);
}
```

**Do not add that example to production:** CEP detection already belongs to `addresses`.

Higher priorities win overlaps. Candidates are collected against original offsets, then accepted in priority/length/start order before the result is rebuilt. Avoid rewriting input during detection. Global patterns are required for `matchAll()`.

Preserve JSON, `.env`, URLs and code syntax where only a value is sensitive. Match the complete value without consuming unrelated words, punctuation or later fields. Never log source values or include real credentials in replacements.

## Tests

Add positive, negative, false-positive, overlap, disabled-category and progressive-typing cases. Cover complete and incomplete formats, not just one successful example. Use invented realistic fixtures:

- `Erro: apitoken=SEGREDO_FICTICIO_123`
- JSON and `.env` assignments, including non-sensitive fields before a sensitive assignment.
- Synthetic database connection URLs and nested credential matches.
- CPF with/without punctuation and incomplete digits.
- Phone/address ambiguity, where applicable.

```bash
node build.mjs
node --test
```

Open the generated HTML directly and check typing, paste, highlights, both themes/languages, toggles, clearing, copy and download. Altering inline scripts manually invalidates CSP hashes.

## PDF parity

Browser PDFs use the same `sanitize()` function, so new rules also apply to extractable PDF text. Geometry mapping remains approximate: test synthetic documents and visually check rectangles.

The Python CLI has a separate engine. When applicable, update `DETECTORS` and matching rules in `tools/pdf_rules.py`, add synthetic Python cases and run:

```bash
python -m unittest discover -s tests -p 'test_pdf_*.py' -v
```

Document any difference rather than assuming equivalence. Neither engine performs OCR. A passing test suite does not guarantee the absence of leaks.
