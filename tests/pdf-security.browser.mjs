/** Real PDF.js, offline file://, and an independent PDF structure/pixel verifier. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const engine = process.env.PDF_TEST_ENGINE || 'chromium';
const engines = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
assert.ok(['chromium', 'firefox', 'webkit'].includes(engine), `Unknown engine: ${engine}`);
const folder = process.env.PDF_TEST_OUTPUT_DIR || await mkdtemp(join(tmpdir(), 'safepaste-pdf-security-'));
await mkdir(folder, { recursive: true });
const verifier = fileURLToPath(new URL('./pdf-security-fixtures.py', import.meta.url));
const standalone = join(folder, 'standalone.html');
await copyFile(new URL('../index.html', import.meta.url), standalone);
const python = process.env.PDF_TEST_PYTHON || 'python3';
execFileSync(python, [verifier, 'generate', folder], { stdio: 'inherit' });
const sensitiveName = 'fixture-98765432100-synthetic@example.invalid.pdf';
await copyFile(join(folder, 'synthetic.pdf'), join(folder, sensitiveName));
const browser = await engines[engine].launch({
  headless: true,
  executablePath: engine === 'chromium' ? process.env.CHROME_BIN : undefined,
  // WebKit's offline emulation also rejects file://. A closed local proxy and
  // request interception keep it isolated while still allowing the file URL.
  proxy: engine === 'webkit' ? { server: 'http://127.0.0.1:9' } : undefined,
});
console.log(`Testing ${engine} ${browser.version()} with network blocked`);
const outside = [];
const consoleMessages = [];
const unexpectedDialogs = [];
let downloads = 0;
let confirmed = 'dismiss';
const expected = [];

try {
  const context = await browser.newContext({ offline: engine !== 'webkit', locale: 'en-US', acceptDownloads: true });
  const isExternal = url => /^(https?|wss?):/i.test(url);
  context.on('request', request => { if (isExternal(request.url())) outside.push(request.url()); });
  await context.route(/^https?:/i, route => route.abort());
  await context.addInitScript(() => {
    window.testWorkers = { started: 0, closed: 0 };
    window.testViolations = [];
    addEventListener('securitypolicyviolation', event => testViolations.push({
      directive: event.violatedDirective, blocked: event.blockedURI, source: event.sourceFile,
      line: event.lineNumber, phase: window.testPhase,
    }));
    const originalWorker = window.Worker;
    window.Worker = class extends originalWorker {
      constructor(...args) {
        super(...args);
        testWorkers.started++;
      }
      terminate() {
        testWorkers.closed++;
        return super.terminate();
      }
    };
  });
  const page = await context.newPage();
  page.on('request', request => { if (isExternal(request.url())) outside.push(request.url()); });
  page.on('websocket', socket => outside.push(socket.url()));
  page.on('pageerror', error => consoleMessages.push(error.message));
  page.on('console', message => consoleMessages.push(message.text()));
  page.on('download', () => downloads++);
  page.on('dialog', async dialog => {
    if (dialog.type() !== 'confirm') {
      unexpectedDialogs.push(dialog.message());
      await dialog.dismiss();
      return;
    }
    if (confirmed === 'accept') await dialog.accept();
    else await dialog.dismiss();
  });
  const el = id => page.locator('#' + id);
  const idle = () => page.waitForFunction(() => !document.querySelector('#pdf-pick').disabled);
  const select = async name => {
    await page.evaluate(name => { window.testPhase = `select ${name}`; }, name);
    await el('pdf-file').setInputFiles(join(folder, name));
    await idle();
  };
  const message = () => el('pdf-message').textContent();
  const confirmReview = async () => {
    await el('pdf-reviewed').check();
    await el('pdf-raster').check();
    assert.equal(await el('pdf-export').isEnabled(), true);
  };
  const workers = () => page.evaluate(() => window.testWorkers);
  const capture = async pageNumber => {
    await page.evaluate(pageNumber => { window.testPhase = `capture ${pageNumber}`; }, pageNumber);
    const result = await page.evaluate(async () => {
      const canvas = document.querySelector('#pdf-canvas');
      const overlay = document.querySelector('#pdf-overlay');
      const { width, height } = canvas;
      const source = canvas.getContext('2d').getImageData(0, 0, width, height).data;
      const mask = overlay.getContext('2d').getImageData(0, 0, width, height).data;
      const rgb = new Uint8Array(width * height * 3);
      let x0 = width, y0 = height, x1 = 0, y1 = 0;
      for (let i = 0; i < width * height; i++) {
        const covered = mask[4 * i + 3] === 255;
        if (covered) {
          const x = i % width;
          const y = Math.floor(i / width);
          x0 = Math.min(x, x0); y0 = Math.min(y, y0);
          x1 = Math.max(x + 1, x1); y1 = Math.max(y + 1, y1);
        } else {
          rgb[3 * i] = source[4 * i];
          rgb[3 * i + 1] = source[4 * i + 1];
          rgb[3 * i + 2] = source[4 * i + 2];
        }
      }
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', rgb));
      const preview = document.createElement('canvas');
      preview.width = width;
      preview.height = height;
      const context = preview.getContext('2d');
      context.drawImage(canvas, 0, 0);
      context.drawImage(overlay, 0, 0);
      return {
        size: [width, height],
        boxes: x1 ? [[x0, y0, x1, y1]] : [],
        digest: Array.from(hash, n => n.toString(16).padStart(2, '0')).join(''),
        png: preview.toDataURL('image/png').split(',')[1],
      };
    });
    const { png, ...evidence } = result;
    expected[pageNumber - 1] = evidence;
    // Avoid screenshot tooling injecting inline styles in the WebKit page.
    await writeFile(join(folder, `preview-${pageNumber}.png`), Buffer.from(png, 'base64'));
    return evidence;
  };

  await page.goto(pathToFileURL(standalone).href);
  await el('mode-pdf').click();
  await select(sensitiveName);
  assert.match(await message(), /Preview ready/);
  assert.equal(await el('pdf-name').textContent(), sensitiveName);
  assert.equal(await el('pdf-reviewed').isDisabled(), true);
  assert.equal(await el('pdf-export').isDisabled(), true);
  assert.deepEqual(await workers(), { started: 1, closed: 0 });

  const automatic = page.locator('.pdf-remove-rect').first();
  assert.match(await automatic.getAttribute('aria-label'), /Remove automatic/);
  await automatic.click();
  assert.match(await el('pdf-warning').textContent(), /were removed/);
  await el('pdf-restore-auto').click();
  const first = await capture(1);
  assert.equal(first.boxes.length, 1);
  const [left, top, right, bottom] = first.boxes[0];
  assert.ok(left <= 60 && top < 165 && right >= 500 && bottom > 165, first.boxes[0].join(','));
  const firstNonWhite = await page.evaluate(() => {
    const canvas = document.querySelector('#pdf-canvas');
    const context = canvas.getContext('2d');
    const ink = (x, y, width, height) => [...context.getImageData(x, y, width, height).data]
      .some((value, index) => index % 4 !== 3 && value < 200);
    return { hidden: ink(60, 310, 450, 27), form: ink(60, 385, 220, 39), visible: ink(60, 145, 450, 20) };
  });
  assert.deepEqual(firstNonWhite, { hidden: false, form: false, visible: true });

  await el('pdf-next').click();
  await idle();
  assert.match(await el('pdf-warning').textContent(), /no extractable text/);
  assert.deepEqual(await page.evaluate(() => [...document.querySelector('#pdf-canvas')
    .getContext('2d').getImageData(638, 390, 1, 1).data]), [24, 90, 190, 255]);
  await page.locator('[data-locale="pt-BR"]').click();
  assert.match(await el('pdf-warning').textContent(), /não tem texto extraível/);
  assert.equal(await el('pdf-page').textContent(), 'Página 2 de 3');
  await el('pdf-overlay').scrollIntoViewIfNeeded();
  const scanBounds = await el('pdf-overlay').boundingBox();
  const drag = async () => {
    await page.mouse.move(scanBounds.x + scanBounds.width * 27 / 360, scanBounds.y + scanBounds.height * 72 / 240);
    await page.mouse.down();
    await page.mouse.move(scanBounds.x + scanBounds.width * 242 / 360, scanBounds.y + scanBounds.height * 108 / 240);
    await page.mouse.up();
  };
  await drag();
  assert.match(await page.locator('.pdf-remove-rect').first().getAttribute('aria-label'), /Remover tarja manual/);
  await el('pdf-undo').click();
  assert.equal(await page.locator('.pdf-remove-rect').count(), 0);
  await drag();
  const second = await capture(2);
  const [sx, sy, ex, ey] = second.boxes[0];
  assert.ok(sx <= 60 && sy <= 150 && ex >= 480 && ey >= 210, second.boxes[0].join(','));

  await el('pdf-next').click();
  await idle();
  const third = await capture(3);
  assert.deepEqual(third.size, [480, 720]);
  const [rx, ry, rright, rbottom] = third.boxes[0];
  assert.ok(rx < 314 && ry <= 60 && rright > 314 && rbottom > 250, third.boxes[0].join(','));
  await writeFile(join(folder, 'expected.json'), JSON.stringify(expected));
  await confirmReview();
  console.log('PASS: real PDF.js offline, digital/scan/rotation, manual/automatic edits, localized review');

  // Native chooser dismissal and a rejected conversion leave the reviewed state intact.
  const chooser = page.waitForEvent('filechooser');
  await el('pdf-restart').click();
  await (await chooser).setFiles([]);
  assert.equal(await el('pdf-name').textContent(), sensitiveName);
  await el('pdf-export').click();
  assert.equal(downloads, 0);
  assert.equal(await el('pdf-reviewed').isChecked(), true);

  for (const [name, error] of [['invalid.pdf', /inválido|por completo/], ['password.pdf', /senha/]]) {
    await select(name);
    assert.match(await message(), error);
    assert.equal(await el('pdf-name').textContent(), sensitiveName);
    assert.equal(await el('pdf-reviewed').isChecked(), true);
  }
  assert.deepEqual(await workers(), { started: 3, closed: 2 });
  console.log('PASS: invalid and encrypted replacement rollback and worker disposal');

  // Give the real File reader a reproducible cancellation point without replacing PDF.js.
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    window.finishTestRead = null;
    File.prototype.arrayBuffer = function () {
      File.prototype.arrayBuffer = read;
      return new Promise((resolve, reject) => { window.finishTestRead = () => read.call(this).then(resolve, reject); });
    };
  });
  await el('pdf-file').setInputFiles(join(folder, 'synthetic.pdf'));
  await page.waitForFunction(() => Boolean(window.finishTestRead));
  await el('pdf-cancel').click();
  await idle();
  await page.evaluate(() => { window.finishTestRead(); window.finishTestRead = null; });
  assert.match(await message(), /cancelada/);
  assert.equal(await el('pdf-reviewed').isChecked(), true);
  assert.deepEqual(await workers(), { started: 3, closed: 2 });
  await page.locator('[data-locale="en-US"]').click();
  assert.match(await message(), /canceled/);

  // Hold the export's first raster digest, then cancel before any file can be saved.
  await page.evaluate(() => {
    const digest = SubtleCrypto.prototype.digest;
    window.finishTestDigest = null;
    SubtleCrypto.prototype.digest = function (...args) {
      SubtleCrypto.prototype.digest = digest;
      return new Promise((resolve, reject) => {
        window.finishTestDigest = () => digest.apply(this, args).then(resolve, reject);
      });
    };
  });
  confirmed = 'accept';
  await el('pdf-export').click();
  await page.waitForFunction(() => Boolean(window.finishTestDigest));
  await el('pdf-cancel').click();
  await page.evaluate(() => { window.finishTestDigest(); window.finishTestDigest = null; });
  await idle();
  assert.match(await message(), /canceled/);
  assert.equal(downloads, 0);
  assert.equal(await el('pdf-reviewed').isChecked(), false);
  await confirmReview();

  // Alter one readback during export page 2 after the first page succeeded.
  // The real writer must receive no partial document.
  await page.evaluate(() => {
    const read = CanvasRenderingContext2D.prototype.getImageData;
    let calls = 0;
    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
      const pixels = read.apply(this, args);
      if (++calls === 3) {
        pixels.data[0] ^= 255;
        CanvasRenderingContext2D.prototype.getImageData = read;
      }
      return pixels;
    };
  });
  confirmed = 'accept';
  await el('pdf-export').click();
  await idle();
  assert.match(await message(), /differs from the reviewed preview/);
  assert.equal(downloads, 0);
  assert.equal(await el('pdf-reviewed').isChecked(), false);
  assert.equal(await el('pdf-reviewed').isDisabled(), true);
  await el('pdf-prev').click();
  await idle();
  assert.equal(await el('pdf-reviewed').isEnabled(), true);
  console.log('PASS: canceled export and no partial download on page 2 raster mismatch');

  for (const locale of ['en-US', 'pt-BR']) {
    await page.locator(`[data-locale="${locale}"]`).click();
    await confirmReview();
    const downloading = page.waitForEvent('download');
    await el('pdf-export').click();
    const download = await downloading;
    assert.equal(download.suggestedFilename(), locale === 'en-US' ? 'SafePaste-protected.pdf' : 'SafePaste-protegido.pdf');
    await download.saveAs(join(folder, `export-${locale}.pdf`));
    await idle();
  }
  assert.equal(downloads, 2);
  await select('image-limit.pdf');
  assert.match(await message(), /Prévia pronta/);
  await el('pdf-next').click();
  await idle();
  assert.match(await message(), /Não foi possível renderizar/);
  assert.equal(await el('pdf-page').textContent(), 'Página 1 de 3');
  assert.equal(await el('pdf-reviewed').isDisabled(), true);
  assert.equal(await el('pdf-export').isDisabled(), true);
  assert.equal(downloads, 2);
  console.log('PASS: a PDF that exceeds the embedded-image limit on page 2 cannot be exported');
  await select(sensitiveName);
  assert.equal(await el('pdf-reviewed').isChecked(), false);
  assert.deepEqual(await workers(), { started: 5, closed: 4 });
  await el('pdf-close').click();
  await idle();
  assert.deepEqual(await workers(), { started: 5, closed: 5 });
  assert.deepEqual(await page.evaluate(() => ({
    pixels: [...document.querySelectorAll('#pdf-canvas, #pdf-overlay')].map(canvas => canvas.width * canvas.height),
    filename: document.querySelector('#pdf-name').textContent,
    storage: Object.keys(localStorage),
    session: pdfSession,
    violations: testViolations,
  })), { pixels: [0, 0], filename: '', storage: ['safepaste-language'], session: null, violations: [] });
  assert.deepEqual(outside, []);
  assert.deepEqual(consoleMessages, []);
  assert.deepEqual(unexpectedDialogs, []);
  console.log('PASS: no external requests, raw PDF console logs, CSP violations or active PDF dialogs');
  console.log('PASS: replacement and close release workers, canvases and document references');
  if (process.env.PDF_DEMO_OUTPUT) {
    await page.locator('[data-locale="pt-BR"]').click();
    await el('pdf-file').setInputFiles(fileURLToPath(new URL('../examples/demo-original.pdf', import.meta.url)));
    await idle();
    assert.match(await message(), /Prévia pronta/);
    assert.equal(await el('pdf-page').textContent(), 'Página 1 de 1');
    assert.equal(await page.locator('.pdf-remove-rect').count(), 4);
    await confirmReview();
    const downloading = page.waitForEvent('download');
    await el('pdf-export').click();
    await (await downloading).saveAs(process.env.PDF_DEMO_OUTPUT);
    await idle();
    await el('pdf-close').click();
    await idle();
    assert.deepEqual(outside, []);
    assert.deepEqual(consoleMessages, []);
    assert.deepEqual(await page.evaluate(() => testViolations), []);
    console.log('PASS: demonstration exported by the browser workflow');
  }
  await context.close();
} finally {
  await browser.close();
}
execFileSync(python, [verifier, 'verify', folder], { stdio: 'inherit' });
console.log(`PDF security evidence: ${folder}`);
