"""Regression for the image-only demonstration distributed with SafePaste."""
from pathlib import Path
import unittest

try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None

DEMO = Path(__file__).resolve().parents[1] / "examples" / "demo-sanitizado.pdf"


@unittest.skipIf(PdfReader is None, "Install tests/requirements-pdf-security.txt for PDF inspection")
class TestDistributedDemo(unittest.TestCase):
    def test_demo_contains_only_a_new_page_and_its_protected_pixels(self):
        reader = PdfReader(DEMO, strict=True)
        self.assertEqual(set(reader.trailer), {"/Size", "/Root"})
        self.assertEqual(set(reader.root_object), {"/Type", "/Pages"})
        self.assertFalse(reader.attachments)
        self.assertIsNone(reader.metadata)
        self.assertEqual(len(reader.pages), 1)
        self.assertEqual(set(reader.xref[0]) - {0}, set(range(1, 6)))
        page = reader.pages[0]
        self.assertEqual(list(page.mediabox), [0, 0, 595, 842])
        self.assertEqual(set(page), {"/Type", "/Parent", "/MediaBox", "/Resources", "/Contents"})
        self.assertFalse(page.extract_text())
        self.assertEqual(set(page["/Resources"]), {"/XObject"})
        images = page["/Resources"]["/XObject"]
        self.assertEqual(set(images), {"/Im0"})
        image = images["/Im0"]
        self.assertEqual(image["/Subtype"], "/Image")
        self.assertEqual(image["/Filter"], "/FlateDecode")
        self.assertEqual(image["/ColorSpace"], "/DeviceRGB")
        self.assertEqual([op for _, op in page.get_contents().operations], [b"q", b"cm", b"Do", b"Q"])
        width, height = image["/Width"], image["/Height"]
        pixels = image.get_data()
        self.assertEqual(len(pixels), width * height * 3)
        # Sample the interior of each approved mask in original page coordinates.
        for x, y in [(180, 245), (180, 285), (180, 330), (180, 373)]:
            offset = (int(y * height / 842) * width + int(x * width / 595)) * 3
            self.assertEqual(pixels[offset:offset + 3], bytes(3), (x, y))
