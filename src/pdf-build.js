import { LocalizedError } from './i18n.js';
/** Produce a new image-only PDF from losslessly compressed, redacted RGB pixels. */
export const MAX_RASTER_BYTES = 80 * 1024 * 1024;
export function buildRasterPDF(pages) {
  if (!Array.isArray(pages) || !pages.length) throw new LocalizedError('pdf.noPages');
  const encoder = new TextEncoder();
  const pieces = [];
  const offsets = [0];
  let size = 0;
  const bytes = str => encoder.encode(str);
  function add(value) { const item = typeof value === 'string' ? bytes(value) : value; pieces.push(item); size += item.length; }
  function object(id, parts) {
    offsets[id] = size;
    add(`${id} 0 obj\n`);
    for (const part of parts) add(part);
    add('\nendobj\n');
  }
  // PDF header with a binary comment, encoded separately to keep offsets exact.
  add('%PDF-1.4\n%SAFEPASTE\n');
  const count = pages.length;
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  object(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  object(2, [`<< /Type /Pages /Count ${count} /Kids [${kids}] >>`]);
  pages.forEach((page, i) => {
    const pageId = 3 + i * 3;
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    const { rgbDeflate, pixelWidth, pixelHeight, width, height } = page;
    if (!(rgbDeflate instanceof Uint8Array) || rgbDeflate.length < 8 ||
      (rgbDeflate[0] & 15) !== 8 || ((rgbDeflate[0] << 8) + rgbDeflate[1]) % 31 !== 0 ||
      ![pixelWidth, pixelHeight].every(Number.isSafeInteger) ||
      ![pixelWidth, pixelHeight, width, height].every(v => Number.isFinite(v) && v > 0)) {
      throw new LocalizedError('pdf.invalidPage', { page: i + 1 });
    }
    const w = Number(width.toFixed(3));
    const h = Number(height.toFixed(3));
    object(pageId, [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`
    ]);
    object(imageId, [
      `<< /Type /XObject /Subtype /Image /Width ${Math.round(pixelWidth)} /Height ${Math.round(pixelHeight)} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${rgbDeflate.length} >>\nstream\n`,
      rgbDeflate,
      '\nendstream'
    ]);
    const drawing = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`;
    object(contentId, [`<< /Length ${bytes(drawing).length} >>\nstream\n`, drawing, 'endstream']);
  });
  const xref = size;
  const total = 2 + count * 3;
  add(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= total; id++) add(`${String(offsets[id]).padStart(10,'0')} 00000 n \n`);
  add(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  if (size > MAX_RASTER_BYTES) throw new LocalizedError('pdf.outputLimit');
  const result = new Uint8Array(size); let p = 0;
  for (const chunk of pieces) { result.set(chunk, p); p += chunk.length; }
  return result;
}
export async function compressRedactedPixels(rgba) {
  const rgb = new Uint8Array(rgba.length / 4 * 3);
  for (let input = 0, output = 0; input < rgba.length; input += 4) {
    rgb[output++] = rgba[input];
    rgb[output++] = rgba[input + 1];
    rgb[output++] = rgba[input + 2];
  }
  try {
    const stream = new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } finally {
    rgb.fill(0);
    rgba.fill(0);
  }
}
