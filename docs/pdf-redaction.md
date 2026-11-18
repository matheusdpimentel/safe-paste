# Local PDF CLI prototype

This guide covers the independent **Python CLI**. The experimental browser implementation is documented in [pdf-browser.md](pdf-browser.md). Both are best-effort tools and require visual review.

## Installation and use

Use Python 3.10 or later in an isolated environment.

macOS/Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r tools/requirements-pdf.txt
python tools/redact_pdf.py "original.pdf" "protected.pdf"
```

Windows PowerShell:

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r tools/requirements-pdf.txt
python tools/redact_pdf.py "original.pdf" "protected.pdf"
```

Quote paths containing spaces. The original is never overwritten; existing output files are refused.

```bash
python tools/redact_pdf.py --help
python tools/redact_pdf.py original.pdf protected.pdf --dpi 240
python tools/redact_pdf.py original.pdf protected.pdf --disable emails
```

All categories start enabled. `--disable` reduces protection. No-match exports are refused unless `--allow-empty` is explicitly supplied after review. Browser PT/EN preferences do not configure this separate CLI.

## Pixel redaction and new output

1. PDFium (`pypdfium2`) reads/renders local pages.
2. Independent rules in `tools/pdf_rules.py` inspect extractable text.
3. Character positions map recognized values to page regions.
4. Rendering produces an image; opaque black pixels replace detected regions.
5. ReportLab builds a completely new image-only PDF.

Original objects, hidden text, attachments, forms, links, signatures and metadata are not copied. Never substitute removable rectangle annotations for raster redactions. Approximate page dimensions, layout, colors and typography remain as pixels; vector fidelity, searchable/selectable text and text accessibility are lost. Output size may grow. Default resolution is 200 DPI.

## Fail-closed limits

- No OCR. Pages without extractable text are refused; mixed pages can still contain sensitive pixels in images.
- Rotated pages, shifted crop boxes and ambiguous character/geometry mappings are refused.
- Names, faces, free-form secrets and unknown patterns may remain visible.
- Inspect **every page** after export. Empty extracted text is useful structural evidence, not proof of visual coverage.
- Revoke/rotate credentials already exposed elsewhere; later sanitization cannot undo exposure.

The synthetic examples `examples/demo-original.pdf` / `examples/demo-sanitizado.pdf` illustrate layout and redactions. Do not use real secrets in fixtures.

## Tests and dependencies

```bash
python -m unittest discover -s tests -p 'test_pdf_*.py' -v
```

Tests cover independent rule offsets, phone/CPF/address overlaps, page dimensions/count, black pixel regions, no extractable text, no overwrite, no-match guards and scanned-page rejection.

Optional dependencies: `pypdfium2` (Apache-2.0/BSD-3-Clause plus PDFium component licenses), Pillow and ReportLab. Review upstream licenses before redistributing binaries; they are not bundled here. The browser's PDF.js dependency is separate. Rule parity with JavaScript must be checked explicitly.

Future work may include audited local PDF.js distribution and more precise geometry fixtures. OCR requires an explicit privacy design and maintainer approval; do not automatically invoke external APIs.
