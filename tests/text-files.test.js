import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectTextFile, decodeTextBuffer, validateJsonFile, sanitizedJsonIsValid, protectedTextFilename, MAX_TEXT_FILE_BYTES } from '../src/text-files.js';
import { sanitize } from '../src/sanitize.js';

test('only .txt, .json and .md are accepted, case insensitive', () => {
  for (const name of ['notas.txt', 'config.JSON', 'LEIA-ME.Md']) assert.ok(inspectTextFile({name, size:100}));
  for (const name of ['index.html', '.env', 'secrets.json.exe', 'report.pdf', 'config.yaml']) assert.throws(() => inspectTextFile({name,size:100}),{ code: 'file.unsupported' });
});
test('size limit prevents loading oversized files', () => {
  assert.equal(inspectTextFile({name:'a.md',size:MAX_TEXT_FILE_BYTES}),'md');
  assert.throws(() => inspectTextFile({name:'a.md',size:MAX_TEXT_FILE_BYTES+1}),{ code: 'file.size' });
});
test('UTF-8 decoder accepts BOM and accents but rejects invalid encodings and binary', () => {
  const encoder=new TextEncoder();
  assert.equal(decodeTextBuffer(encoder.encode('\uFEFFOlá, São José').buffer),'Olá, São José');
  assert.throws(() => decodeTextBuffer(new Uint8Array([0xC3,0x28]).buffer),{ code: 'file.encoding' });
  assert.throws(() => decodeTextBuffer(encoder.encode('x\u0000y').buffer),{ code: 'file.binary' });
});
test('JSON object and arrays keep valid structure and redact sensitive values', () => {
  const original=JSON.stringify({telefone:'(48) 98888-7777',endereco:'Rua das Flores, 123',api_token:'EXEMPLO_SECRETO_ABC',logs:[{email:'teste@example.com'}]},null,2);
  validateJsonFile(original);
  const protectedText=sanitize(original).text;
  assert.ok(sanitizedJsonIsValid(protectedText));
  assert.doesNotMatch(protectedText, /EXEMPLO_SECRETO_ABC|98888-7777|das Flores|teste@example.com/);
  const parsed=JSON.parse(protectedText);
  assert.ok(Array.isArray(parsed.logs));
  assert.ok(protectedText.includes('\n  '),'preserve pretty print indentation');
});
test('broken .json is rejected, invalid protected JSON is detected', () => {
  assert.throws(() => validateJsonFile('{"api_token":'),{ code: 'file.json' });
  assert.equal(sanitizedJsonIsValid('{"invalid":'),false);
});
test('Markdown keeps headings and code-fence structure', () => {
  const original='# Relatório\n\nContato: usuario@empresa.com.br\n\n```env\napitoken=SECRET_TEST_TOKEN_123\n```';
  const protectedText=sanitize(original).text;
  assert.ok(protectedText.startsWith('# Relatório\n\n'));
  assert.ok(protectedText.endsWith('\n```'));
  assert.doesNotMatch(protectedText, /usuario@empresa.com.br|SECRET_TEST_TOKEN_123/);
});
test('safe protected file names and fallback for manual text', () => {
  assert.equal(protectedTextFilename('config.json'),'config-protegido.json');
  assert.equal(protectedTextFilename('LEIA-ME.md'),'LEIA-ME-protegido.md');
  assert.equal(protectedTextFilename('log.txt'),'log-protegido.txt');
  assert.equal(protectedTextFilename('c:\\downloads\\segredo.json'),'segredo-protegido.json');
  assert.equal(protectedTextFilename(null),'safepaste-protegido.txt');
});
test('generated HTML embeds helpers, buttons and local restrictions', async () => {
  const { readFileSync } = await import('node:fs');
  const html=readFileSync(new URL('../index.html', import.meta.url),'utf8');
  assert.match(html, /id="text-pick"/);
  assert.match(html, /id="download-text"/);
  assert.match(html, /function inspectTextFile/);
  assert.match(html, /function decodeTextBuffer/);
  assert.doesNotMatch(html, /import \{ inspectTextFile/);
});
