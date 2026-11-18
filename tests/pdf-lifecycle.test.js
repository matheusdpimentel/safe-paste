import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { createContext, runInContext } from 'node:vm';

const compatibility = readFileSync(new URL('../src/pdf-compat.js', import.meta.url), 'utf8');

test('standalone PDF reader authenticates embedded worker bytes and blocks network by CSP', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const worker = html.match(/id="pdf-worker-data">([^<]+)<\/script>/)[1];
  const library = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const workerSource = gunzipSync(Buffer.from(worker, 'base64')).toString('utf8');
  const workerHash = createHash('sha256').update(workerSource).digest('hex');
  const libraryHash = createHash('sha256').update(library).digest('base64');
  for (const source of [library, workerSource]) {
    const vendorStart = source.indexOf('Copyright 2024 Mozilla Foundation');
    assert.ok(vendorStart > 0 && source.slice(0, vendorStart).includes(compatibility));
  }
  assert.ok(html.includes(`PDF_WORKER_DIGEST = '${workerHash}'`));
  assert.ok(html.includes(`'sha256-${libraryHash}'`));
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /worker-src blob:;/);
  assert.doesNotMatch(csp, /https?:|unsafe-inline|['"]unsafe-eval/);
});

test('PDF.js compatibility supports caches and numeric totals without newer built-ins', () => {
  const context = createContext({ assert });
  runInContext(`
    for (const prototype of [Map.prototype, WeakMap.prototype]) {
      delete prototype.getOrInsert;
      delete prototype.getOrInsertComputed;
    }
    delete Math.sumPrecise;
  `, context);
  runInContext(compatibility, context);
  runInContext(`
    for (const cache of [new Map(), new WeakMap()]) {
      const key = {};
      assert.equal(cache.getOrInsertComputed(key, received => {
        assert.equal(received, key);
        return undefined;
      }), undefined);
      assert.equal(cache.has(key), true);
      assert.equal(cache.getOrInsertComputed(key, () => assert.fail('cache hit called initializer')), undefined);
      assert.equal(cache.getOrInsert(key, 'ignored'), undefined);
      const other = {};
      assert.equal(cache.getOrInsert(other, 'inserted'), 'inserted');
      assert.equal(cache.get(other), 'inserted');
    }
    assert.equal(sumPDFNumbers([1e16, 1, -1e16]), 1);
    assert.throws(() => sumPDFNumbers([Infinity]), RangeError);
  `, context);
});
