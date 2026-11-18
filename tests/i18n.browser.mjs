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
  await check('TXT, JSON and Markdown downloads keep the extension and hide the source name', async () => {
    await chooseLocale(page, 'en-US');
    for (const [extension, content] of [['txt', 'apitoken=SYNTHETIC_TOKEN_123'], ['json', '{"api_token":"SYNTHETIC_TOKEN_123"}'], ['md', '# Invented report\n\napitoken=SYNTHETIC_TOKEN_123']]) {
      await upload(page, `fictitious-98765432100-test@example.invalid.${extension}`, content);
      await page.waitForFunction(value => document.querySelector('#input').value === value, content);
      assert.equal(await page.locator('#input').inputValue(), content);
      const result = await page.locator('#output').inputValue();
      assert.ok(!result.includes('SYNTHETIC_TOKEN_123'));
      const downloaded = page.waitForEvent('download');
      await page.locator('#download-text').click();
      const download = await downloaded;
      assert.equal(download.suggestedFilename(), `safepaste-protected.${extension}`);
      assert.equal(await readFile(await download.path(), 'utf8'), result);
      if (extension === 'json') assert.doesNotThrow(() => JSON.parse(result));
    }
    await chooseLocale(page, 'pt-BR');
    const downloaded = page.waitForEvent('download');
    await page.locator('#download-text').click();
    assert.equal((await downloaded).suggestedFilename(), 'safepaste-protegido.md');
    assert.deepEqual(requests, []);
  });
  await check('invalid imports and invalid protected JSON translate without losing the loaded file', async () => {
    await upload(page, 'broken.json', '{');
    await page.waitForFunction(() => !document.querySelector('#text-file-status').hidden);
    assert.match(await text(page, '#text-file-status'), /JSON válido/);
    await chooseLocale(page, 'en-US');
    assert.match(await text(page, '#text-file-status'), /invalid JSON/);
    assert.equal(await text(page, '#text-file-name'), 'fictitious-98765432100-test@example.invalid.md');
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
  await page.setViewportSize({ width: 375, height: 812 });
  await chooseLocale(page, 'pt-BR');
  await page.screenshot({ path: join(outputDir, 'mobile-pt.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  await context.close();
  console.log(`${checks} browser scenarios passed. Artifacts: ${outputDir}`);
} finally { await browser.close(); }
