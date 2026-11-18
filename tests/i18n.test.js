import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { catalogs, createI18n, detectLocale, LANGUAGE_STORAGE_KEY, LocalizedError, translatedError } from '../src/i18n.js';
import { inspectTextFile, protectedTextFilename } from '../src/text-files.js';

const memoryStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return { values, getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
};

test('browser languages select Portuguese or English, with English as fallback', () => {
  for (const languages of [['pt-BR'], ['pt-PT'], ['PT']]) assert.equal(detectLocale(languages), 'pt-BR');
  for (const languages of [[], ['fr-FR'], ['en-GB'], ['en-US', 'pt-BR']]) assert.equal(detectLocale(languages), 'en-US');
  assert.equal(detectLocale(['de-DE', 'pt-BR']), 'pt-BR');
});

test('first visit detects language without persisting; explicit preference survives a new session', () => {
  const storage = memoryStorage();
  const first = createI18n({ storage, languages: ['pt-BR'] });
  assert.equal(first.locale, 'pt-BR');
  assert.equal(storage.values.size, 0);
  first.setLocale('en-US');
  assert.deepEqual([...storage.values], [[LANGUAGE_STORAGE_KEY, 'en-US']]);
  assert.equal(createI18n({ storage, languages: ['pt-BR'] }).locale, 'en-US');
  first.setLocale('en-US');
  assert.equal(storage.values.size, 1);
});

test('invalid preferences and unavailable storage do not break language switching', () => {
  const invalid = createI18n({ storage: memoryStorage({ [LANGUAGE_STORAGE_KEY]: 'xx' }), languages: ['pt-BR'] });
  assert.equal(invalid.locale, 'pt-BR');
  assert.equal(invalid.setLocale('xx'), false);
  const storage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const i18n = createI18n({ storage, languages: ['pt-BR'] });
  assert.equal(i18n.setLocale('en-US'), true);
  assert.equal(i18n.t('text.waiting'), 'Waiting for text');
});

test('catalogs have identical keys, plural forms and interpolation variables', () => {
  assert.deepEqual(Object.keys(catalogs['pt-BR']).sort(), Object.keys(catalogs['en-US']).sort());
  const placeholders = message => [...message.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for (const [key, english] of Object.entries(catalogs['en-US'])) {
    const portuguese = catalogs['pt-BR'][key];
    assert.equal(typeof portuguese, typeof english, key);
    const forms = typeof english === 'object' ? Object.keys(english) : [null];
    if (typeof english === 'object') assert.deepEqual(Object.keys(portuguese), forms, key);
    for (const form of forms) {
      const en = form ? english[form] : english;
      const pt = form ? portuguese[form] : portuguese;
      assert.ok(en && pt, key);
      assert.deepEqual(placeholders(pt), placeholders(en), key);
    }
  }
});

test('plural counts and dynamic categories switch in place and subscriptions can be removed', () => {
  const i18n = createI18n({ languages: ['en-US'] });
  const seen = [];
  const unsubscribe = i18n.subscribe(() => seen.push(i18n.t('text.highlights', { count: 2 })));
  assert.equal(i18n.t('text.highlights', { count: 1 }), '1 highlighted segment');
  i18n.setLocale('pt-BR');
  assert.deepEqual(seen, ['2 trechos destacados']);
  assert.equal(i18n.t('text.characters', { count: 0 }), '0 caracteres');
  assert.equal(i18n.t('kind.Telefones'), 'Telefones');
  unsubscribe();
  i18n.setLocale('en-US');
  assert.equal(seen.length, 1);
  assert.equal(i18n.t('kind.Telefones'), 'Phone numbers');
  assert.throws(() => i18n.t('missing.key'), /Unknown translation/);
});

test('validation errors retain stable keys and are translated after switching', () => {
  const i18n = createI18n({ languages: ['pt-BR'] });
  let error;
  try { inspectTextFile({ name: 'example.exe', size: 10 }); } catch (value) { error = value; }
  assert.ok(error instanceof LocalizedError);
  assert.match(translatedError(error, i18n), /Formato não suportado/);
  i18n.setLocale('en-US');
  assert.match(translatedError(error, i18n), /Unsupported format/);
  assert.match(translatedError(new LocalizedError('pdf.invalidPage', { page: 2 }), i18n), /Page 2/);
  assert.equal(translatedError(new Error('SYNTHETIC_PRIVATE_CONTENT'), i18n), i18n.t('error.unknown'));
  assert.equal(translatedError({ name: 'PasswordException' }, i18n), i18n.t('pdf.password'));
});

test('download names localize only the suffix, preserving the original stem and extension', () => {
  assert.equal(protectedTextFilename('relatorio.json', { suffix: 'protected' }), 'relatorio-protected.json');
  assert.equal(protectedTextFilename(null, { suffix: 'protected' }), 'safepaste-protected.txt');
  assert.equal(protectedTextFilename('relatorio.md'), 'relatorio-protegido.md');
});

test('standalone HTML includes both catalogs, valid CSP hashes and no local imports', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  for (const source of [script, css]) {
    assert.ok(html.includes(`sha256-${createHash('sha256').update(source).digest('base64')}`));
  }
  assert.doesNotThrow(() => new Script(script));
  assert.doesNotMatch(script, /^import \{|^export /m);
  assert.match(script, /const enUS =/);
  assert.match(script, /const ptBR =/);
  assert.match(html, /<html lang="en-US">/);
  const template = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  for (const [, key] of template.matchAll(/data-i18n(?:-[\w-]+)?="([^"]+)"/g)) {
    assert.equal(typeof catalogs['en-US'][key], 'string', key);
  }
});
