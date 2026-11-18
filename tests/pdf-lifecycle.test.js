import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

test('standalone PDF reader authenticates embedded worker bytes and blocks network by CSP', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const worker = html.match(/id="pdf-worker-data">([^<]+)<\/script>/)[1];
  const library = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const workerHash = createHash('sha256').update(gunzipSync(Buffer.from(worker, 'base64'))).digest('hex');
  const libraryHash = createHash('sha256').update(library).digest('base64');
  assert.ok(html.includes(`PDF_WORKER_DIGEST = '${workerHash}'`));
  assert.ok(html.includes(`'sha256-${libraryHash}'`));
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /worker-src blob:;/);
  assert.doesNotMatch(csp, /https?:|unsafe-inline|['"]unsafe-eval/);
});
