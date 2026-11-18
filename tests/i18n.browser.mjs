/** Optional integration tests. Use a local Playwright installation; no production dependency. */
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const outputDir = process.env.TEST_OUTPUT_DIR || await mkdtemp(join(tmpdir(), 'safepaste-i18n-'));
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
const appURL = new URL('../index.html', import.meta.url).href;
const errors = [];
const chooseLocale = (page, locale) => page.locator(`[data-locale="${locale}"]`).click();
const text = (page, selector) => page.locator(selector).textContent();
const upload = (page, name, content, selector = '#text-file') => page.locator(selector).setInputFiles({ name, mimeType: selector === '#pdf-file' ? 'application/pdf' : 'text/plain', buffer: Buffer.from(content) });
let checks = 0;
async function check(name, run) { await run(); checks++; console.log(`PASS: ${name}`); }

try {
  await check('file:// first visit detects pt-BR, en-US and unsupported languages without saving content', async () => {
    for (const [locale, expected] of [['pt-BR', 'pt-BR'], ['en-US', 'en-US'], ['fr-FR', 'en-US']]) {
      const context = await browser.newContext({ locale });
      await context.setOffline(true);
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(appURL);
      assert.equal(await page.locator('html').getAttribute('lang'), expected);
      assert.equal(await page.evaluate(() => localStorage.getItem('safepaste-language')), null);
      assert.ok(await text(page, 'h1'));
      await context.close();
    }
  });
  const context = await browser.newContext({ locale: 'pt-BR', acceptDownloads: true });
  await context.setOffline(true);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const requests = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.goto(appURL);
  await check('all translated nodes have content and controls are accessible', async () => {
    for (const locale of ['en-US', 'pt-BR']) {
      await chooseLocale(page, locale);
      const missing = await page.locator('[data-i18n]').evaluateAll(elements => elements.filter(el => !el.textContent.trim()).map(el => el.dataset.i18n));
      assert.deepEqual(missing, []);
      assert.equal(await page.locator(`[data-locale="${locale}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#input').getAttribute('aria-label'), locale === 'pt-BR' ? 'Texto original' : 'Original text');
      await page.screenshot({ path: join(outputDir, `text-light-${locale}.png`), fullPage: true });
    }
  });
  await check('switching preserves text, detector choices, selection, theme and editor state', async () => {
    await page.locator('#example').click();
    await page.locator('#detection-settings').evaluate(el => { el.open = true; });
    await page.locator('#det-uuid').uncheck();
    await page.locator('#theme-toggle').click();
    await page.locator('#input').evaluate(el => { el.setSelectionRange(2, 14); });
    const state = () => page.evaluate(() => ({
      input: document.querySelector('#input').value, output: document.querySelector('#output').value,
      start: document.querySelector('#input').selectionStart, end: document.querySelector('#input').selectionEnd,
      theme: document.documentElement.dataset.theme, settings: document.querySelector('#detection-settings').open,
      toggles: [...document.querySelectorAll('[data-detector]')].map(el => el.checked),
    }));
    const before = await state();
    await chooseLocale(page, 'en-US');
    assert.deepEqual(await state(), before);
    assert.match(await text(page, '#details'), /Credentials/);
    assert.match(await text(page, '#detection-summary'), /12 of 13/);
    assert.match(await page.locator('#highlight').innerHTML(), /title="Credentials"/);
    await page.screenshot({ path: join(outputDir, 'text-en.png'), fullPage: true });
    await chooseLocale(page, 'pt-BR');
    assert.deepEqual(await state(), before);
    await page.screenshot({ path: join(outputDir, 'text-pt.png'), fullPage: true });
  });
  await check('CPF typing and all-disabled warnings remain blocked in both languages', async () => {
    await page.locator('#input').fill('CPF: 123.456');
    assert.equal(await page.locator('#copy').isDisabled(), true);
    await chooseLocale(page, 'en-US');
    assert.match(await text(page, '#original-status'), /Incomplete CPF/);
    await page.locator('#input').fill('CPF: 123.456.789-09');
    assert.equal(await page.locator('#copy').isDisabled(), false);
    for (const toggle of await page.locator('[data-detector]').all()) await toggle.uncheck();
    assert.equal(await page.locator('#copy').isDisabled(), true);
    await chooseLocale(page, 'pt-BR');
    assert.match(await text(page, '#details'), /Todas as detecções/);
    await page.locator('#enable-all').click();
  });
  await check('copy success and fallback feedback translate while visible', async () => {
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } }));
    await page.locator('#copy').click();
    assert.match(await text(page, '#copy'), /Copiado/);
    await chooseLocale(page, 'en-US');
    assert.match(await text(page, '#copy'), /Copied/);
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('blocked'); } } }));
    await page.locator('#copy').click();
    await chooseLocale(page, 'pt-BR');
    assert.match(await text(page, '#copy'), /Selecione e copie/);
    assert.match(await text(page, '#details'), /Ctrl\+C/);
  });
  await check('TXT, JSON and Markdown import/edit/download stay local and keep extension', async () => {
    await chooseLocale(page, 'en-US');
    for (const [extension, content] of [['txt', 'apitoken=SYNTHETIC_TOKEN_123'], ['json', '{"api_token":"SYNTHETIC_TOKEN_123"}'], ['md', '# Invented report\n\napitoken=SYNTHETIC_TOKEN_123']]) {
      await upload(page, `synthetic.${extension}`, content);
      await page.waitForFunction(value => document.querySelector('#input').value === value, content);
      assert.equal(await page.locator('#input').inputValue(), content);
      const result = await page.locator('#output').inputValue();
      assert.ok(!result.includes('SYNTHETIC_TOKEN_123'));
      const downloaded = page.waitForEvent('download');
      await page.locator('#download-text').click();
      const download = await downloaded;
      assert.equal(download.suggestedFilename(), `synthetic-protected.${extension}`);
      assert.equal(await readFile(await download.path(), 'utf8'), result);
      if (extension === 'json') assert.doesNotThrow(() => JSON.parse(result));
    }
    await chooseLocale(page, 'pt-BR');
    const downloaded = page.waitForEvent('download');
    await page.locator('#download-text').click();
    assert.equal((await downloaded).suggestedFilename(), 'synthetic-protegido.md');
    assert.deepEqual(requests, []);
  });
  await check('invalid imports and invalid protected JSON translate without losing the loaded file', async () => {
    await upload(page, 'broken.json', '{');
    await page.waitForFunction(() => !document.querySelector('#text-file-status').hidden);
    assert.match(await text(page, '#text-file-status'), /JSON válido/);
    await chooseLocale(page, 'en-US');
    assert.match(await text(page, '#text-file-status'), /invalid JSON/);
    assert.equal(await text(page, '#text-file-name'), 'synthetic.md');
    await upload(page, 'synthetic.json', '{"cpf":12345678909}');
    await page.waitForFunction(() => document.querySelector('#input').value === '{"cpf":12345678909}');
    assert.equal(await page.locator('#copy').isDisabled(), true);
    assert.equal(await page.locator('#download-text').isDisabled(), true);
    assert.match(await text(page, '#protected-status'), /Invalid protected JSON/);
    await chooseLocale(page, 'pt-BR');
    assert.match(await text(page, '#protected-status'), /JSON protegido inválido/);
    await page.locator('#clear').click();
    assert.equal(await page.locator('#text-file-info').isHidden(), true);
  });
  await check('manual language persists after reload; content and detector choices do not', async () => {
    await chooseLocale(page, 'en-US');
    await page.locator('#input').fill('apitoken=SYNTHETIC_NEVER_SAVED_123');
    const stored = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    assert.deepEqual(Object.keys(stored).sort(), ['safepaste-language', 'safepaste-theme']);
    assert.ok(!JSON.stringify(stored).includes('SYNTHETIC'));
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en-US');
    assert.equal(await page.locator('#input').inputValue(), '');
    assert.equal(await page.locator('[data-detector]:checked').count(), 13);
  });
  await check('storage denial still allows language switching', async () => {
    const restricted = await browser.newContext({ locale: 'pt-BR' });
    await restricted.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }));
    await restricted.setOffline(true);
    const tab = await restricted.newPage();
    await tab.goto(appURL);
    assert.equal(await tab.locator('html').getAttribute('lang'), 'pt-BR');
    await chooseLocale(tab, 'en-US');
    assert.equal(await tab.locator('html').getAttribute('lang'), 'en-US');
    await restricted.close();
  });
  await check('offline PDF reader errors translate while remaining visible', async () => {
    const offline = await browser.newContext({ locale: 'en-US' });
    await offline.setOffline(true);
    const tab = await offline.newPage();
    tab.on('pageerror', error => errors.push(error.message));
    await tab.goto(appURL);
    await tab.locator('#mode-pdf').click();
    await upload(tab, 'synthetic.pdf', '%PDF-1.4\nOFFLINE', '#pdf-file');
    await tab.waitForFunction(() => document.querySelector('#pdf-message').classList.contains('pdf-error'));
    assert.match(await text(tab, '#pdf-message'), /Could not load the PDF reader/);
    await chooseLocale(tab, 'pt-BR');
    assert.match(await text(tab, '#pdf-message'), /Não foi possível carregar o leitor PDF/);
    await offline.close();
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await chooseLocale(page, 'pt-BR');
  await page.screenshot({ path: join(outputDir, 'mobile-pt.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 1280, height: 900 });
  await context.setOffline(false);
  const mockPDF = `
    window.__destroyed = [];
    export const GlobalWorkerOptions = {};
    export const Util = { transform(a,b) { return b; } };
    export function getDocument({data}) {
      const source = new TextDecoder().decode(data);
      const bad = source.includes('CORRUPT');
      const document = {numPages:2, async getPage(number) { return {
        getViewport({scale}) { return {width:595*scale,height:842*scale,transform:[scale,0,0,scale,0,0]}; },
        async getTextContent() { await new Promise(resolve => setTimeout(resolve, 400)); return {items:number===1?[{str:'CPF: 123.456.789-09',transform:[1,0,0,13,40,65],width:200,height:13,hasEOL:true}]:[]}; },
        render({canvas}) { const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,canvas.width,canvas.height);c.fillStyle='black';c.fillText('SYNTHETIC PAGE '+number,40,40);return {promise:Promise.resolve()}; }
      }; }};
      return {promise:bad?Promise.reject(Object.assign(new Error('synthetic'),{name:'InvalidPDFException'})):Promise.resolve(document),async destroy(){window.__destroyed.push(source);}};
    }`;
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: mockPDF, headers: { 'Access-Control-Allow-Origin': '*' } }));
  await check('PDF loading progress, warnings, counters and remove buttons translate during use', async () => {
    await page.locator('#mode-pdf').click();
    await upload(page, 'synthetic.pdf', '%PDF-1.4\nFIRST', '#pdf-file');
    await page.waitForFunction(() => /Analisando página/.test(document.querySelector('#pdf-message').textContent));
    assert.equal(await page.locator('#pdf-restart').isDisabled(), true);
    await chooseLocale(page, 'en-US');
    assert.match(await text(page, '#pdf-message'), /Analyzing page/);
    await page.waitForFunction(() => !document.querySelector('#pdf-ready').hidden);
    await page.waitForFunction(() => !document.querySelector('#pdf-restart').disabled);
    assert.match(await text(page, '#pdf-page'), /Page 1 of 2/);
    assert.match(await text(page, '#pdf-warning'), /still need to view 1 page/);
    assert.match(await page.locator('.pdf-remove-rect').first().getAttribute('aria-label'), /Remove automatic suggestion from page 1/);
    await page.locator('.pdf-remove-rect').first().click();
    await chooseLocale(page, 'pt-BR');
    assert.match(await text(page, '#pdf-warning'), /foram removidas/);
    await page.locator('#pdf-restore-auto').click();
    await page.locator('#pdf-next').click();
    assert.match(await text(page, '#pdf-warning'), /não tem texto extraível/);
    await chooseLocale(page, 'en-US');
    assert.match(await text(page, '#pdf-warning'), /no extractable text/);
    const overlay = await page.locator('#pdf-overlay').boundingBox();
    await page.mouse.move(overlay.x+40,overlay.y+70); await page.mouse.down();
    await page.mouse.move(overlay.x+160,overlay.y+100); await page.mouse.up();
    await page.locator('#pdf-reviewed').check();
    await page.locator('#pdf-raster').check();
    const before = await text(page, '#pdf-stats');
    await chooseLocale(page, 'pt-BR');
    assert.equal(await page.locator('#pdf-reviewed').isChecked(), true);
    assert.equal(await page.locator('#pdf-raster').isChecked(), true);
    assert.equal(await page.locator('#pdf-export').isEnabled(), true);
    assert.notEqual(await text(page, '#pdf-stats'), before);
    await page.screenshot({ path: join(outputDir, 'pdf-pt.png'), fullPage: true });
  });
  await check('PDF export confirms image conversion and produces a downloadable PDF in both languages', async () => {
    for (const locale of ['pt-BR', 'en-US']) {
      await chooseLocale(page, locale);
      const dialog = page.waitForEvent('dialog').then(async value => {
        assert.match(value.message(), locale === 'pt-BR' ? /imagens/ : /image pages/);
        await value.accept();
      });
      const downloaded = page.waitForEvent('download');
      await page.locator('#pdf-export').click();
      const download = await downloaded;
      await dialog;
      assert.equal(download.suggestedFilename(), locale === 'pt-BR' ? 'SafePaste-protegido.pdf' : 'SafePaste-protected.pdf');
      await download.saveAs(join(outputDir, `export-${locale}.pdf`));
      await page.waitForFunction(() => !document.querySelector('#pdf-restart').disabled);
    }
  });
  await check('failed PDF replacement keeps review and the previous document, with translated errors', async () => {
    await upload(page, 'corrupt.pdf', '%PDF-1.4\nCORRUPT', '#pdf-file');
    await page.waitForFunction(() => document.querySelector('#pdf-ready-message').classList.contains('pdf-error'));
    assert.match(await text(page, '#pdf-ready-message'), /previous file is still open/);
    await chooseLocale(page, 'pt-BR');
    assert.match(await text(page, '#pdf-ready-message'), /inválido ou está corrompido/);
    assert.match(await text(page, '#pdf-ready-message'), /arquivo anterior continua aberto/);
    assert.equal(await text(page, '#pdf-name'), 'synthetic.pdf');
    assert.equal(await page.locator('#pdf-reviewed').isChecked(), true);
    await upload(page, 'second.pdf', '%PDF-1.4\nSECOND', '#pdf-file');
    await page.waitForFunction(() => document.querySelector('#pdf-name').textContent === 'second.pdf' && !document.querySelector('#pdf-restart').disabled);
    assert.equal(await page.locator('#pdf-reviewed').isChecked(), false);
    assert.ok((await page.evaluate(() => window.__destroyed)).some(value => value.includes('FIRST')));
  });
  if (process.env.REAL_PDF === '1') await check('real PDF.js reads and exports the synthetic example over file://', async () => {
    await page.unroute('https://cdn.jsdelivr.net/**');
    await page.reload();
    await chooseLocale(page, 'en-US');
    await page.locator('#mode-pdf').click();
    await page.locator('#pdf-file').setInputFiles(new URL('../examples/demo-original.pdf', import.meta.url).pathname);
    await page.waitForFunction(() => !document.querySelector('#pdf-ready').hidden, { }, { timeout: 45000 });
    await page.waitForFunction(() => !document.querySelector('#pdf-restart').disabled);
    while (await page.locator('#pdf-next').isEnabled()) await page.locator('#pdf-next').click();
    await page.locator('#pdf-reviewed').check(); await page.locator('#pdf-raster').check();
    await chooseLocale(page, 'pt-BR');
    const dialog = page.waitForEvent('dialog').then(value => value.accept());
    const downloaded = page.waitForEvent('download');
    await page.locator('#pdf-export').click();
    await (await downloaded).saveAs(join(outputDir, 'export-real.pdf')); await dialog;
    await page.waitForFunction(() => !document.querySelector('#pdf-restart').disabled);
    await page.screenshot({ path: join(outputDir, 'pdf-real.png'), fullPage: true });
  });
  assert.deepEqual(errors, []);
  await context.close();
  console.log(`${checks} browser scenarios passed. Artifacts: ${outputDir}`);
} finally { await browser.close(); }
