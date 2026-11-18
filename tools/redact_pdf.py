#!/usr/bin/env python3
"""Optional offline PDF redaction prototype (CLI).

Rebuilds PDF pages from locally rendered images, with opaque black pixels burned
into all recognized areas. Source PDF objects, text, metadata, annotations and
attachments are NOT copied to the output. Detection remains best effort.

Dependencies chosen to keep the CLI separate from the MIT browser app and avoid
strong-copyleft PDF library requirements: pypdfium2 / Pillow / ReportLab.
"""
from __future__ import annotations

import argparse
import io
import json
import math
from pathlib import Path
import sys

try:
    import pypdfium2 as pdfium
    from PIL import ImageDraw
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen.canvas import Canvas
except ImportError:
    print("Dependências ausentes. Instale: python -m pip install -r tools/requirements-pdf.txt", file=sys.stderr)
    sys.exit(3)

from pdf_rules import DETECTORS, detect


def page_text(page):
    """Extract text plus bbox per character. Abort if glyph indexing is ambiguous."""
    tp = page.get_textpage()
    n = tp.count_chars()
    text = tp.get_text_range(0, n)
    if len(text) != n:
        raise ValueError("PDF tem mapeamento texto/glifos ambíguo. Não foi gerado um arquivo; revise manualmente.")
    boxes = []
    for i, char in enumerate(text):
        if char in "\n\r":
            boxes.append(None)
            continue
        left, bottom, right, top = tp.get_charbox(i)
        boxes.append((left, bottom, right, top))
    return text, boxes


def hit_rectangles(hits, text, boxes, page_width, page_height):
    """Return black bar rectangles in PDF points with top-left origin."""
    rects=[]
    for hit in hits:
        segments=[]
        for i in range(hit.start, hit.end):
            bbox=boxes[i]
            if bbox is None:
                if segments:
                    rects.append(_merge(segments,page_width,page_height))
                    segments=[]
                continue
            l,b,r,t=bbox
            # Whitespace glyphs in PDFium often have zero height; ignore them.
            if r <= l or t <= b:
                continue
            rect=(l,page_height-t,r,page_height-b)
            # Keep a continuous bar across punctuation and underscores, whose
            # character bounding boxes can sit far below normal letters.
            # Split only when text extraction moves backwards (visual wrap).
            if segments and rect[0] < segments[-1][0]-3:
                rects.append(_merge(segments,page_width,page_height))
                segments=[]
            segments.append(rect)
        if segments:
            rects.append(_merge(segments,page_width,page_height))
    return [rect for rect in rects if rect[2] > rect[0] and rect[3] > rect[1]]


def _merge(rects, w, h):
    return (max(0,min(r[0] for r in rects)-2), max(0,min(r[1] for r in rects)-2),
            min(w,max(r[2] for r in rects)+2), min(h,max(r[3] for r in rects)+2))


def sanitize_pdf(input_path: Path, output_path: Path, dpi: int=200, disable=(), allow_empty=False):
    if input_path.resolve() == output_path.resolve():
        raise ValueError("A saída não pode sobrescrever o PDF original.")
    if not input_path.is_file() or input_path.suffix.lower() != '.pdf':
        raise ValueError("Informe um arquivo PDF existente.")
    if output_path.exists():
        raise FileExistsError("O arquivo de saída já existe. Escolha outro nome.")
    if not 110 <= dpi <= 300:
        raise ValueError("DPI permitido: 110 a 300.")
    enabled = {key: key not in disable for key in DETECTORS}
    total = 0
    by_category:dict[str,int] = {}
    payloads=[]
    doc=pdfium.PdfDocument(str(input_path))
    try:
        if not len(doc):
            raise ValueError("PDF sem páginas.")
        for page_num in range(len(doc)):
            page=doc[page_num]
            try:
                if page.get_rotation() != 0:
                    raise ValueError(f"Página {page_num+1} rotacionada: não suportada no protótipo; nenhum arquivo criado.")
                page_w,page_h=page.get_size()
                x0,y0,x1,y1=page.get_bbox()
                # Coordinates can be shifted by CropBox/MediaBox. Until the
                # transform is tested, refuse instead of risking misplaced bars.
                if any(abs(v)>0.5 for v in (x0,y0,x1-page_w,y1-page_h)):
                    raise ValueError(f"Página {page_num+1} com caixa de corte deslocada: ainda não suportada.")
                text,boxes=page_text(page)
                if not text.strip():
                    raise ValueError(f"Página {page_num+1} sem texto extraível: pode ser digitalização. Nenhum PDF criado. OCR/revisão manual não implementados.")
                hits=detect(text,enabled)
                if hits:
                    tp=page.get_textpage()
                    # Cross-check char indexing for every sensitive match. We
                    # never trust positions if PDFium's text mapping disagrees.
                    for hit in hits:
                        fragment=tp.get_text_range(hit.start,hit.end-hit.start)
                        if fragment != text[hit.start:hit.end]:
                            raise ValueError(f"Página {page_num+1}: texto e posições não coincidem; saída cancelada.")
                    tp.close()
                rects=hit_rectangles(hits,text,boxes,page_w,page_h)
                if hits and not rects:
                    raise ValueError(f"Página {page_num+1}: não foi possível posicionar as tarjas de segurança.")
                total+=len(hits)
                for hit in hits:
                    by_category[hit.category]=by_category.get(hit.category,0)+1
                payloads.append((page_num,page_w,page_h,rects))
            finally:
                page.close()
        if not total and not allow_empty:
            raise ValueError("Nenhum padrão identificado. PDF não exportado. Use --allow-empty apenas após revisão manual.")

        # Nothing from original document is reused. Render from scratch to a
        # brand new PDF containing solely raster page images with black bars.
        out=io.BytesIO()
        canvas=Canvas(out, pageCompression=1, invariant=1)
        canvas.setTitle('SafePaste - PDF com tarjas')
        canvas.setAuthor('SafePaste')
        canvas.setSubject('PDF regenerado sem objetos originais; revisar visualmente')
        scale=dpi/72
        for page_num,width,height,rects in payloads:
            page=doc[page_num]
            try:
                bitmap=page.render(scale=scale)
                image=bitmap.to_pil().convert('RGB')
                drawer=ImageDraw.Draw(image)
                for r in rects:
                    left=max(0,math.floor(r[0]*scale)); top=max(0,math.floor(r[1]*scale))
                    right=min(image.width,math.ceil(r[2]*scale)); bottom=min(image.height,math.ceil(r[3]*scale))
                    drawer.rectangle((left,top,right,bottom),fill='black')
                canvas.setPageSize((width,height))
                canvas.drawImage(ImageReader(image),0,0,width=width,height=height)
                canvas.showPage()
                image.close()
            finally:
                page.close()
        canvas.save()
        output_path.parent.mkdir(parents=True,exist_ok=True)
        # Exclusive creation prevents accidental overwrite even if file appears
        # between validation and export.
        with output_path.open('xb') as f:
            f.write(out.getvalue())
        return {"pages":len(payloads),"matches":total,"categories":by_category,"dpi":dpi}
    finally:
        doc.close()


def main():
    parser=argparse.ArgumentParser(description="SafePaste PDF (experimental): tarjas pretas irreversíveis em PDF regenerado localmente.")
    parser.add_argument('input',type=Path,help='PDF original')
    parser.add_argument('output',type=Path,help='Novo PDF sanitizado')
    parser.add_argument('--dpi',type=int,default=200,help='Resolução (110-300; padrão 200)')
    parser.add_argument('--disable',action='append',choices=DETECTORS,default=[],help='Desativa uma categoria por vez')
    parser.add_argument('--allow-empty',action='store_true',help='Exporta mesmo sem detecção; exige revisão humana')
    args=parser.parse_args()
    try:
        stats=sanitize_pdf(args.input,args.output,args.dpi,args.disable,args.allow_empty)
    except (ValueError,FileExistsError,RuntimeError,FileNotFoundError) as exc:
        parser.exit(2,f'Erro: {exc}\n')
    print(json.dumps(stats,indent=2,ensure_ascii=False))
    print('AVISO: revise visualmente todas as páginas. Detecção por padrões pode falhar.')

if __name__=='__main__':
    main()
