import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, DEFAULT_DETECTIONS } from '../src/sanitize.js';
import { readFileSync } from 'node:fs';

const fixtures = {
  assignments: 'apitoken=segredo_teste_12345',
  tokens: 'ghp_12345678901234567890123456789012',
  bearer: 'Authorization: Bearer abcdefghijklmnopqrstuv',
  jwt: 'eyJ123456.eyJ123456.signature123',
  privateKeys: '-----BEGIN PRIVATE KEY-----\nAAA_TESTE\n-----END PRIVATE KEY-----',
  urlCredentials: 'postgresql://admin:senha_123@db.exemplo.invalid/teste',
  cpf: 'CPF: 123.456.789-09',
  cnpj: 'CNPJ: 12.345.678/0001-99',
  emails: 'contato@empresa.com.br',
  phones: '(48) 91234-5678',
  addresses: 'Rua das Flores, 123, Centro - Florianópolis/SC',
  ip: '10.20.30.40',
  uuid: '550e8400-e29b-41d4-a716-446655440000',
};

const keys = Object.keys(DEFAULT_DETECTIONS);
const off = Object.fromEntries(keys.map(key => [key,false]));

test('all 13 kinds of detection are on by default', () => {
  assert.deepEqual(Object.values(DEFAULT_DETECTIONS),Array(13).fill(true));
});

test('every switch is connected to a real independently selectable rule', () => {
  for (const key of keys) {
    assert.ok(fixtures[key],`missing fixture for ${key}`);
    const input = fixtures[key];
    const disabled = sanitize(input, off);
    assert.equal(disabled.text,input,`all off should not redact ${key}`);
    const enabled = sanitize(input,{...off,[key]:true});
    assert.notEqual(enabled.text,input,`rule ${key} did not redact`);
    const switchedOff = sanitize(input,{...off,[key]:false});
    assert.equal(switchedOff.text,input,`switch ${key} did not disable`);
  }
});

test('HTML starts collapsed, defaults all switches on, and contains matching control IDs', () => {
  const html = readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/<details class="quick-settings" id="detection-settings">/);
  for (const key of keys) assert.match(html,new RegExp(`data-detector="${key}"[^>]*checked`));
  assert.equal((html.match(/data-detector="[^"]+"/g)||[]).length,13);
});
