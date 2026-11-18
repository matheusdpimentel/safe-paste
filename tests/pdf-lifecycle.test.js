import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/pdf-mode.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('PDF replacement keeps its loading task and never calls destroy on the document proxy', () => {
  assert.match(src, /pdfState\.loadingTask=newTask/);
  assert.match(src, /await disposePDFTask\(previous\.loadingTask\)/);
  assert.doesNotMatch(src, /pdfState\.document\.destroy\s*\(/);
  assert.match(src, /if\(newTask && !installed\) await disposePDFTask\(newTask\)/);
});

test('PDF change handler clears the native file input and keeps visible errors', () => {
  assert.match(src, /elPdf\.file\.value=''/);
  assert.match(src, /pdfUI\('pdf-ready-message'\)/);
  assert.match(html, /id="pdf-ready-message"/);
  assert.match(src, /previous\.document/);
});
