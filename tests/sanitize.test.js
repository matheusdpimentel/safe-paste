import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitize } from '../src/sanitize.js';
test('remove secret values without leaking originals',()=>{
 const sample='OPENAI_API_KEY=sk-proj-TEST_TOKEN_123456789012\nDATABASE_URL=postgresql://admin:SenhaReal@db.exemplo.com:5432/prod\nEmail=nome@empresa.com.br';
 const result=sanitize(sample);
 assert.ok(!result.text.includes('TEST_TOKEN'));
 assert.ok(!result.text.includes('SenhaReal'));
 assert.ok(!result.text.includes('nome@empresa.com.br'));
 assert.ok(result.hits.length >= 3);
});
test('redacts pasted token',()=>{
 const result=sanitize('ghp_123456789012345678901234567890123456');
 assert.equal(result.text,'TOKEN_FICTICIO');
});
test('detects personal data only when enabled',()=>{
 assert.equal(sanitize('a@b.com',{personal:false}).text,'a@b.com');
 assert.equal(sanitize('a@b.com').text,'usuario@exemplo.invalid');
});
test('keeps normal code unchanged',()=>{
 const source='const answer = 42;\nconsole.log(answer);';
 assert.equal(sanitize(source).text,source);
});
test('does not edit repeated credential fields inconsistently',()=>{
 const result=sanitize('PASSWORD=senha_1\nPASSWORD=senha_1');
 assert.equal(result.text,'PASSWORD=VALOR_FICTICIO\nPASSWORD=VALOR_FICTICIO');
});
test('empty input',()=>{
 assert.deepEqual(sanitize('').hits,[]);
 assert.equal(sanitize('').text,'');
});
test('CPF with punctuation, even fictitious invalid checksum',()=>{
  const r=sanitize('CPF: 123.456.789-09');
  assert.ok(!r.text.includes('123.456.789-09'));
  assert.equal(r.hits[0].kind,'CPFs');
});
test('CPF without punctuation when labeled',()=>{
  const r=sanitize('cpf=12345678909');
  assert.ok(!r.text.includes('12345678909'));
});
test('11-digit unformatted values are redacted even with invalid checksum',()=>{
  assert.equal(sanitize('52998224725').text,'00000000000');
  assert.equal(sanitize('12345678901').text,'00000000000');
});
test('apitoken and api_token across common formats',()=>{
 const src=`apitoken = meu_token_teste_123\napi_token: outra_chave_456\n{"apitoken":"terceiro_segredo_789"}\nconst apiToken = 'quarto_segredo_123'`;
 const r=sanitize(src);
 for(const secret of ['meu_token_teste_123','outra_chave_456','terceiro_segredo_789','quarto_segredo_123']) assert.ok(!r.text.includes(secret),secret);
 assert.equal(r.hits.length,4);
});
test('secrets are removed without destroying JSON syntax',()=>{
 const r=sanitize('{"api_token":"XYZ789", "count":42, "enabled":true}');
 assert.deepEqual(JSON.parse(r.text),{api_token:'VALOR_FICTICIO',count:42,enabled:true});
});
test('URL credentials and bearer headers',()=>{
 const r=sanitize('postgresql://root:superpass@db.example.com/test\nAuthorization: Bearer abcd123456789012345');
 assert.ok(!r.text.includes('superpass'));
 assert.ok(!r.text.includes('abcd123456789012345'));
});
test('CNPJ formatted and labeled unformatted',()=>{
 const r=sanitize('CNPJ: 12.345.678/0001-99\ncnpj=12345678000199');
 assert.ok(!r.text.includes('12.345.678/0001-99'));
 assert.ok(!r.text.includes('12345678000199'));
});

test('CPF only redacts once all 11 digits are present, both formats',()=>{
 for(const cpf of ['52998224725','12345678909','11999999999']) {
   for(let i=1;i<11;i++) {
     const partial='CPF: '+cpf.slice(0,i);
     assert.equal(sanitize(partial).text,partial,`premature hit at ${i} for ${cpf}`);
   }
   assert.equal(sanitize('CPF: '+cpf).text,'CPF: 00000000000');
 }
 for(const cpf of ['529.982.247-25','123.456.789-09','119.999.999-99']) {
   for(let i=1;i<cpf.length;i++) {
     const partial='CPF: '+cpf.slice(0,i);
     assert.equal(sanitize(partial).text,partial,`premature formatted hit at ${i}: ${partial}`);
   }
   assert.equal(sanitize('CPF: '+cpf).text,'CPF: 000.000.000-00');
 }
});
test('CPF kept as CPF, not phone, with 9 in third digit',()=>{
 const r=sanitize('CPF: 11999999999');
 assert.equal(r.text,'CPF: 00000000000');
 assert.match(r.hits[0].kind,/CPF/);
});
test('never expose an 11 digit CPF in a larger text with labels',()=>{
 const src='Pessoa teste CPF 529.982.247-25\ncpf: 52998224725\nCPF=12345678909';
 const r=sanitize(src);
 for (const v of ['529.982.247-25','52998224725','12345678909']) assert.ok(!r.text.includes(v));
});

test('redacts a credential assignment inside prose/logs without relying on line start',()=>{
  const src='Falha na integração: apitoken=SEGREDO_TESTE_LONGO_123 no log de hoje';
  const r=sanitize(src);
  assert.ok(!r.text.includes('SEGREDO_TESTE_LONGO_123'));
  assert.equal(r.hits.length,1);
});

test('does not skip secret assignment after a benign log label',()=>{
 const src='CPF: 529.982.247-25\nErro: apitoken=SEGREDO_FICTICIO_123';
 const r=sanitize(src);
 assert.ok(!r.text.includes('SEGREDO_FICTICIO_123'));
 assert.equal(r.hits.length,2);
});


test('phones: Brazilian fixed line, mobile, 0800 and optional country prefix',()=>{
 const cases=['Telefone: (48) 3333-4444','Celular: 48988887777','Telefone: +55 (48) 98888-7777','Fone: 48 3333 4444','WhatsApp: 98888-7777','0800 123 4567'];
 for(const source of cases){const r=sanitize(source);assert.notEqual(r.text,source,source);assert.ok(r.hits.some(h=>h.kind==='Telefones'),source);}
});
test('phone/CPF: explicit labels win, unlabeled 11 digits remain concealed',()=>{
 const mobile=sanitize('Celular: 48988887777');
 assert.equal(mobile.hits[0].kind,'Telefones');
 assert.equal(sanitize('CPF: 11999999999').hits[0].kind,'CPFs / números de 11 dígitos');
 assert.equal(sanitize('11999999999').text,'00000000000');
});
test('addresses with and without labels protect all address components on same line',()=>{
 for(const source of [
  'Endereço: Rua das Flores, 123, apto 201, Centro - São José/SC, CEP 88100-000',
  'Rua das Flores, 123, Centro - Florianópolis/SC',
  'Av. Beira Mar, 1200, Sala 3',
  '{"endereco":"Rua das Flores, 123, apto 22","count":2}'
 ]){
  const r=sanitize(source);
  assert.ok(r.hits.some(h=>h.kind==='Endereços'),source);
  for (const fragment of ['das Flores','Beira Mar']) if (source.includes(fragment)) assert.ok(!r.text.includes(fragment),source);
 }
 const json=sanitize('{"endereco":"Rua das Flores, 123, apto 22","count":2}').text;
 assert.equal(JSON.parse(json).count,2);
});
test('postcode detection and conservative negative examples',()=>{
 assert.equal(sanitize('CEP: 88100000').text,'CEP: 00000000');
 assert.equal(sanitize('CEP 88100-000').text,'CEP 00000-000');
 for(const source of ['Avenida Brasil','Rua das Flores sem número','Endereço: não informado','Código: 88100000']) assert.equal(sanitize(source).text,source);
});
test('address and phone switches work separately for text and shared PDF engine',()=>{
 const source='Rua das Flores, 123\nTelefone: (48) 3333-4444\nCEP: 88100-000';
 const withoutAddress=sanitize(source,{addresses:false});
 assert.ok(withoutAddress.text.includes('Rua das Flores, 123'));
 assert.ok(withoutAddress.text.includes('88100-000'));
 assert.ok(!withoutAddress.text.includes('3333-4444'));
 const withoutPhone=sanitize(source,{phones:false});
 assert.ok(!withoutPhone.text.includes('Rua das Flores, 123'));
 assert.ok(withoutPhone.text.includes('(48) 3333-4444'));
 assert.equal(sanitize(source,{addresses:false,phones:false}).text,source);
});
