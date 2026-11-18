"""Optional tests: python -m unittest discover -s tests -p 'test_pdf_*.py' -v"""
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

try:
    import pypdfium2 as pdfium
    from reportlab.pdfgen.canvas import Canvas
    from PIL import Image
    from pdf_rules import detect
    from redact_pdf import sanitize_pdf
except ImportError:
    pdfium = None


@unittest.skipIf(pdfium is None, "Instale tools/requirements-pdf.txt para testes de PDF")
class TestPDFRedaction(unittest.TestCase):
    def test_detector_offsets(self):
        s = "CPF: 529.982.247-25 e apitoken=SEGREDO_DE_TESTE_123 e contato@empresa.com.br"
        hits = detect(s)
        self.assertIn("529.982.247-25", [s[h.start:h.end] for h in hits])
        self.assertIn("SEGREDO_DE_TESTE_123", [s[h.start:h.end] for h in hits])
        self.assertIn("contato@empresa.com.br", [s[h.start:h.end] for h in hits])
        log = "Erro: apitoken=SEGREDO_FICTICIO_123"
        self.assertIn("SEGREDO_FICTICIO_123", [log[h.start:h.end] for h in detect(log)])

    def test_redacted_pdf_is_image_only_and_preserves_pages(self):
        with tempfile.TemporaryDirectory() as tmp:
            origin=Path(tmp)/'original.pdf'; protected=Path(tmp)/'protected.pdf'
            pdf=Canvas(str(origin),pagesize=(595,842))
            pdf.setTitle('TITULO_PRIVADO_DE_TESTE_123')
            pdf.setFont('Helvetica',13)
            pdf.drawString(62,757,'Relatorio interno - informacoes de teste')
            pdf.drawString(62,722,'CPF: 529.982.247-25')
            pdf.drawString(62,692,'apitoken=SEGREDO_DE_TESTE_123')
            pdf.drawString(62,662,'Contato: contato@empresa.com.br')
            pdf.setFillColorRGB(.92,.96,.92)
            pdf.rect(60,412,475,210,stroke=1,fill=1)
            pdf.setFillColorRGB(0,0,0)
            pdf.drawString(90,572,'Informacao publica que deve continuar visivel')
            pdf.showPage()
            pdf.setPageSize((300,300))
            pdf.drawString(35,245,'Pagina adicional com texto visivel')
            pdf.drawString(35,210,'CPF: 12345678909')
            pdf.showPage()
            pdf.save()
            stats=sanitize_pdf(origin,protected,dpi=170)
            self.assertEqual(stats['pages'],2)
            self.assertGreaterEqual(stats['matches'],4)
            doc=pdfium.PdfDocument(str(protected))
            try:
                self.assertEqual(len(doc),2)
                self.assertEqual(doc[0].get_size(), (595,842))
                self.assertEqual(doc[1].get_size(), (300,300))
                self.assertEqual(doc[0].get_textpage().get_text_range().strip(),'')
                self.assertEqual(doc[1].get_textpage().get_text_range().strip(),'')
                raw=protected.read_bytes()
                for secret in (b'529.982.247-25',b'12345678909',b'SEGREDO_DE_TESTE_123',b'TITULO_PRIVADO_DE_TESTE_123'):
                    self.assertNotIn(secret,raw)
                image=doc[0].render(scale=1.5).to_pil().convert('RGB')
                count=sum(1 for r,g,b in image.crop((70,175,520,330)).get_flattened_data() if (r,g,b)==(0,0,0))
                self.assertGreater(count,600)
            finally:
                doc.close()

    def test_fails_closed_on_scanned_pdf(self):
        with tempfile.TemporaryDirectory() as tmp:
            src=Path(tmp)/'scan.pdf'; dest=Path(tmp)/'sanitizado.pdf'
            with io.BytesIO() as imgbuf:
                Image.new('RGB',(300,100),'white').save(imgbuf,format='PNG')
                from reportlab.lib.utils import ImageReader
                pdf=Canvas(str(src))
                pdf.drawImage(ImageReader(imgbuf),30,500,width=300,height=100)
                pdf.save()
            with self.assertRaisesRegex(ValueError,'sem texto extraível'):
                sanitize_pdf(src,dest)
            self.assertFalse(dest.exists())

    def test_no_match_fails_without_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            src=Path(tmp)/'blank-text.pdf'; dest=Path(tmp)/'sanitizado.pdf'
            pdf=Canvas(str(src));pdf.drawString(30,750,'Somente texto sem dados sensiveis');pdf.save()
            with self.assertRaisesRegex(ValueError,'Nenhum padrão'):
                sanitize_pdf(src,dest)
            self.assertFalse(dest.exists())

    def test_never_overwrites_original(self):
        with tempfile.TemporaryDirectory() as tmp:
            src=Path(tmp)/'src.pdf'
            pdf=Canvas(str(src));pdf.drawString(30,750,'CPF: 529.982.247-25');pdf.save()
            before=src.read_bytes()
            with self.assertRaisesRegex(ValueError,'sobrescrever'):
                sanitize_pdf(src,src)
            self.assertEqual(src.read_bytes(),before)


if __name__=='__main__': unittest.main()
