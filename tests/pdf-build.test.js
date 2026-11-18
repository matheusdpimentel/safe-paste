import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import {buildRasterPDF, compressRedactedPixels} from '../src/pdf-build.js';
const rgbDeflate = deflateSync(Buffer.from([0, 0, 0]));
const page = (w=500,h=700)=>({width:w,height:h,pixelWidth:1,pixelHeight:1,rgbDeflate});

test('creates new image-only PDF objects for each page',()=>{
  const data=buildRasterPDF([page(),page(400,600)]);
  const str=new TextDecoder().decode(data);
  assert.match(str,/^%PDF-1\.4/);
  assert.match(str,/\/Count 2/);
  assert.match(str,/\/MediaBox \[0 0 500 700\]/);
  assert.match(str,/\/MediaBox \[0 0 400 600\]/);
  assert.equal((str.match(/\/Subtype \/Image/g)||[]).length,2);
  assert.equal((str.match(/\/Type \/Page /g)||[]).length,2);
  assert.doesNotMatch(str,/\/Subtype \/Type1|\/Annots|\/EmbeddedFiles|\/AcroForm/);
  assert.match(str,/startxref\n\d+\n%%EOF/);
  const startxref=Number(str.match(/startxref\n(\d+)/)?.[1]);
  assert.equal(str.slice(startxref,startxref+4),'xref');
});
test('rejects pages that do not contain a deflate stream',()=>{
  assert.throws(()=>buildRasterPDF([]),{ code: 'pdf.noPages' });
  assert.throws(()=>buildRasterPDF([{...page(),rgbDeflate:new Uint8Array(8)}]),{ code: 'pdf.invalidPage', values: { page: 1 } });
});

test('compresses RGB without changing any pixel and clears the working RGBA buffer', async () => {
  const rgba = new Uint8Array([0, 0, 0, 255, 241, 36, 78, 255]);
  const rgb = inflateSync(await compressRedactedPixels(rgba));
  assert.deepEqual([...rgb], [0, 0, 0, 241, 36, 78]);
  assert.deepEqual([...rgba], Array(8).fill(0));
});
