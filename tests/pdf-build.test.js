import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRasterPDF} from '../src/pdf-build.js';
const jpeg = new Uint8Array([0xff,0xd8,0xff,0xe0,0x00,0x00,0xff,0xd9]);
const page = (w=500,h=700)=>({width:w,height:h,pixelWidth:w*2,pixelHeight:h*2,jpeg});

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
test('rejects pages that do not contain JPEG pixels',()=>{
  assert.throws(()=>buildRasterPDF([]),{ code: 'pdf.noPages' });
  assert.throws(()=>buildRasterPDF([{...page(),jpeg:new Uint8Array([0,0,0,0,0,0,0,0])}]),{ code: 'pdf.invalidPage', values: { page: 1 } });
});
