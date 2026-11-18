"""Create and independently verify synthetic browser PDF security fixtures."""
import hashlib
from contextlib import closing
import io
import json
from pathlib import Path
import sys

from PIL import Image, ImageDraw
import pypdfium2 as pdfium
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject, DecodedStreamObject, DictionaryObject, EncodedStreamObject,
    IndirectObject, NameObject, NumberObject, TextStringObject,
)
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas

CANARY = "SAFEPASTE_SYNTHETIC_CANARY"


def generate(folder):
    source = io.BytesIO()
    canvas = Canvas(source, pagesize=(360, 240), invariant=1)
    canvas.drawString(25, 210, "Synthetic digital page")
    canvas.drawString(30, 157, f"apitoken={CANARY}_DIGITAL")
    canvas.drawString(30, 110, "Visible link label")
    canvas.setFillColorCMYK(0.1, 0.6, 0.2, 0)
    canvas.rect(280, 165, 26, 20, fill=1, stroke=0)
    canvas.linkURL("https://safepaste.invalid/link", (30, 100, 120, 115))
    canvas.acroForm.textfield(name="Synthetic form", value=f"{CANARY}_FORM",
                              x=30, y=28, width=110, height=20)
    canvas.showPage()

    # The sensitive region is an embedded image, with no text layer.
    image = Image.new("RGB", (360, 240), (245, 248, 244))
    draw = ImageDraw.Draw(image)
    draw.text((25, 25), "Synthetic scanned page", fill="black")
    draw.rectangle((30, 75, 239, 104), fill=(240, 65, 97))
    draw.text((36, 85), f"{CANARY}_SCAN", fill="black")
    draw.rectangle((285, 145, 325, 175), fill=(40, 100, 180))
    canvas.drawImage(ImageReader(image), 0, 0, width=360, height=240)
    canvas.showPage()

    canvas.drawString(25, 210, "Synthetic rotated page")
    canvas.drawString(30, 157, "CPF: 123.456.789-09")
    canvas.showPage()
    canvas.save()

    writer = PdfWriter(clone_from=PdfReader(source))
    writer.pages[2].rotate(90)
    writer.add_metadata({"/Title": CANARY + "_INFO", "/Author": "Invented author"})
    writer.add_attachment("synthetic.txt", (CANARY + "_ATTACHMENT").encode())
    writer.root_object[NameObject("/OpenAction")] = DictionaryObject({
        NameObject("/S"): NameObject("/JavaScript"),
        NameObject("/JS"): TextStringObject('app.alert("SAFEPASTE_SYNTHETIC_CANARY_SCRIPT");'),
    })
    xmp = DecodedStreamObject()
    xmp.set_data(f'<x:xmpmeta xmlns:x="adobe:ns:meta/">{CANARY}_XMP</x:xmpmeta>'.encode())
    xmp[NameObject("/Type")] = NameObject("/Metadata")
    xmp[NameObject("/Subtype")] = NameObject("/XML")
    writer.root_object[NameObject("/Metadata")] = writer._add_object(xmp)
    layer = writer._add_object(DictionaryObject({
        NameObject("/Type"): NameObject("/OCG"),
        NameObject("/Name"): TextStringObject(CANARY + "_LAYER"),
    }))
    writer.root_object[NameObject("/OCProperties")] = DictionaryObject({
        NameObject("/OCGs"): ArrayObject([layer]),
        NameObject("/D"): DictionaryObject({NameObject("/OFF"): ArrayObject([layer])}),
    })
    first = writer.pages[0]
    first["/Resources"][NameObject("/Properties")] = DictionaryObject({NameObject("/Hidden"): layer})
    content = DecodedStreamObject()
    content.set_data(first.get_contents().get_data() + (
        f"\n/OC /Hidden BDC BT /F1 12 Tf 30 75 Td ({CANARY}_HIDDEN) Tj ET EMC\n"
    ).encode())
    first.replace_contents(content)
    # Exercise the embedded OpenJPEG decoder on a small, real JPEG 2000 image.
    jp2 = io.BytesIO()
    Image.new("RGB", (12, 12), (24, 90, 190)).save(jp2, format="JPEG2000")
    stream = EncodedStreamObject()
    stream._data = jp2.getvalue()
    stream.update({
        NameObject("/Type"): NameObject("/XObject"),
        NameObject("/Subtype"): NameObject("/Image"),
        NameObject("/Filter"): NameObject("/JPXDecode"),
        NameObject("/Width"): NumberObject(12),
        NameObject("/Height"): NumberObject(12),
        NameObject("/ColorSpace"): NameObject("/DeviceRGB"),
        NameObject("/BitsPerComponent"): NumberObject(8),
    })
    scanned = writer.pages[1]
    scanned["/Resources"]["/XObject"][NameObject("/LocalJP2")] = writer._add_object(stream)
    contents = DecodedStreamObject()
    contents.set_data(scanned.get_contents().get_data() + b"\nq 20 0 0 20 310 32 cm /LocalJP2 Do Q\n")
    scanned.replace_contents(contents)
    writer.write(folder / "synthetic.pdf")
    image_xobjects = scanned["/Resources"]["/XObject"]
    oversized_image = next(image_xobjects[key] for key in image_xobjects if key != "/LocalJP2")
    original_width = oversized_image["/Width"]
    oversized_image[NameObject("/Width")] = NumberObject(24_000_001)
    writer.write(folder / "image-limit.pdf")
    oversized_image[NameObject("/Width")] = original_width
    writer.encrypt("invented-fixture-password")
    writer.write(folder / "password.pdf")
    (folder / "invalid.pdf").write_bytes(b"%PDF-1.4\nsynthetic invalid PDF\n")


def verify(folder):
    input_pdf = PdfReader(folder / "synthetic.pdf")
    assert input_pdf.get_fields() and input_pdf.attachments and input_pdf.pages[0].get("/Annots")
    for key in ["/Metadata", "/OCProperties", "/OpenAction", "/AcroForm"]:
        assert key in input_pdf.root_object, key
    assert CANARY + "_HIDDEN" in input_pdf.pages[0].get_contents().get_data().decode("latin-1")
    expected = json.loads((folder / "expected.json").read_text())
    for name in ["export-en-US.pdf", "export-pt-BR.pdf"]:
        path = folder / name
        reader = PdfReader(path, strict=True)
        assert set(reader.trailer) == {"/Size", "/Root"}
        assert not reader.metadata and not reader.attachments
        assert set(reader.root_object) == {"/Type", "/Pages"}
        assert set(reader.root_object["/Pages"]) == {"/Type", "/Kids", "/Count"}
        assert len(reader.pages) == len(expected) == 3
        raw = path.read_bytes()
        assert CANARY.encode() not in raw and b"123.456.789-09" not in raw
        table = reader.xref[0]
        assert set(table) - {0} == set(range(1, 12))
        # No orphaned objects or embedded original streams anywhere in the xref.
        assert int(reader.trailer["/Size"]) == 12
        with pdfium.PdfDocument(path) as doc:
            for i, (page, review) in enumerate(zip(reader.pages, expected)):
                assert set(page) == {"/Type", "/Parent", "/MediaBox", "/Resources", "/Contents"}
                assert list(page.mediabox) == ([0, 0, 240, 360] if i == 2 else [0, 0, 360, 240])
                assert not page.extract_text()
                assert set(page["/Resources"]) == {"/XObject"}
                objects = page["/Resources"]["/XObject"]
                assert set(objects) == {"/Im0"}
                image = objects["/Im0"]
                assert set(image) == {
                    "/Type", "/Subtype", "/Width", "/Height", "/ColorSpace", "/BitsPerComponent", "/Filter"
                }
                assert image["/Subtype"] == "/Image" and image["/Filter"] == "/FlateDecode"
                assert [image["/Width"], image["/Height"]] == review["size"]
                width, height = review["size"]
                data = image.get_data()
                assert len(data) == width * height * 3
                assert hashlib.sha256(data).hexdigest() == review["digest"]
                bitmap = Image.frombytes("RGB", (width, height), data)
                for box in review["boxes"]:
                    assert bitmap.crop(tuple(box)).getextrema() == ((0, 0), (0, 0), (0, 0))
                commands = page.get_contents().operations
                assert [op for _, op in commands] == [b"q", b"cm", b"Do", b"Q"]
                assert commands[2][0] == ["/Im0"]

                # Remove the only drawing command. No layer or alternate image reveals source content.
                page[NameObject("/Contents")] = DecodedStreamObject()
                with closing(doc[i]) as rendered_page:
                    with closing(rendered_page.get_textpage()) as text:
                        assert not text.get_text_range().strip()
                    with closing(rendered_page.render()) as rendered:
                        if name == "export-en-US.pdf":
                            rendered.to_pil().save(folder / f"rendered-{i + 1}.png")
        for number in table:
            if number:
                obj = reader.get_object(IndirectObject(number, 0, reader))
                assert obj is not None
        modified = PdfWriter()
        modified.append_pages_from_reader(reader)
        bare = io.BytesIO()
        modified.write(bare)
        with pdfium.PdfDocument(bare.getvalue()) as doc:
            with closing(doc[0]) as page, closing(page.render()) as raster:
                assert raster.to_pil().convert("RGB").getextrema() == ((255, 255),) * 3
        print(f"PASS {name}: strict object allowlist and exact reviewed pixels on 3 pages")


if __name__ == "__main__":
    root = Path(sys.argv[2])
    {"generate": generate, "verify": verify}[sys.argv[1]](root)
