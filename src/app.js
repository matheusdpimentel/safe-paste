import { createI18n, translatePage, translatedError } from './i18n.js';
import { sanitize } from './sanitize.js';
import { inspectTextFile, decodeTextBuffer, validateJsonFile, sanitizedJsonIsValid, protectedTextFilename } from './text-files.js';
const $ = id => document.getElementById(id);
let preferenceStorage;
try { preferenceStorage = localStorage; } catch { /* Preferences remain in memory. */ }
const i18n = createI18n({ storage: preferenceStorage, languages: navigator.languages || [navigator.language] });
const t = (key, values) => i18n.t(key, values);
for (const button of document.querySelectorAll('[data-locale]')) {
  button.addEventListener('click', () => i18n.setLocale(button.dataset.locale));
}
translatePage(i18n, document);
const themeButton = $('theme-toggle');
const themeIcon = $('theme-icon');
const themeLabel = $('theme-label');
const themeStorageKey = 'safepaste-theme';
function readSavedTheme() {
  try { return localStorage.getItem(themeStorageKey); } catch { return null; }
}
function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  themeIcon.textContent = dark ? '☀' : '☾';
  themeLabel.textContent = t(dark ? 'theme.light' : 'theme.dark');
  themeButton.setAttribute('aria-label', t(dark ? 'theme.enableLight' : 'theme.enableDark'));
  themeButton.title = t(dark ? 'theme.enableLight' : 'theme.enableDark');
}
const systemTheme = window.matchMedia?.('(prefers-color-scheme: dark)');
const savedTheme = readSavedTheme();
applyTheme(savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : (systemTheme?.matches ? 'dark' : 'light'));
if (savedTheme !== 'dark' && savedTheme !== 'light') {
  systemTheme?.addEventListener?.('change', event => applyTheme(event.matches ? 'dark' : 'light'));
}
themeButton.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(themeStorageKey, next); } catch { /* Storage unavailable: the theme still works for this page. */ }
});
const input = $('input');
const output = $('output');
const escapeHTML = value => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const detectors = [...document.querySelectorAll('[data-detector]')];
const detectorOptions = () => Object.fromEntries(detectors.map(input => [input.dataset.detector, input.checked]));
function updateSettingsStatus() {
  const enabled = detectors.filter(item => item.checked).length;
  const all = detectors.length;
  $('detection-summary').textContent = enabled === all ? t('settings.all') : t('settings.count', { enabled, total: all });
  $('detection-settings').classList.toggle('has-disabled',enabled < all);
  $('enable-all').disabled = enabled === all;
}

let lastResult = {text:'',hits:[]};
let importedTextFile = null;
let fileReadVersion = 0;
const textFileInput = $('text-file');
const fileStatus = $('text-file-status');
let fileError = null;
let copyFeedback = null;
function showFileStatus(error = null) {
  fileError = error;
  const isError = Boolean(error);
  const message = error ? translatedError(error, i18n) : '';
  fileStatus.textContent = message;
  fileStatus.classList.toggle('is-error', isError);
  fileStatus.hidden = !message;
}
function setImportedTextFile(file) {
  importedTextFile = file;
  $('text-file-info').hidden = !file;
  $('text-file-name').textContent = file ? file.name : '';
}
function clearImportedTextFile() {
  fileReadVersion++;
  textFileInput.value = '';
  setImportedTextFile(null);
  showFileStatus();
}
$('text-pick').addEventListener('click', () => textFileInput.click());
textFileInput.addEventListener('change', async () => {
  const selected = textFileInput.files?.[0];
  if (!selected) return;
  const version = ++fileReadVersion;
  try {
    const extension = inspectTextFile(selected);
    const content = decodeTextBuffer(await selected.arrayBuffer());
    if (version !== fileReadVersion) return;
    if (extension === 'json') validateJsonFile(content);
    setImportedTextFile({ name: selected.name, extension });
    input.value = content;
    input.scrollTop = 0;
    input.scrollLeft = 0;
    showFileStatus();
    update();
  } catch(error) {
    if (version !== fileReadVersion) return;
    showFileStatus(error);
  } finally {
    if (version === fileReadVersion) textFileInput.value = '';
  }
});
function update() {
  lastResult = sanitize(input.value,detectorOptions());
  output.value = lastResult.text;
  copyFeedback = null;
  renderText();
}
function renderText() {
  const original = input.value;
  // During CPF typing, warn rather than pretending the partial number is safe.
  const incompleteCPF = $('det-cpf').checked && /\bCPF\s*[:=#-]?\s*(?:\d[. -]?){1,10}(?=\s|$)/i.test(original);
  const noneEnabled = detectors.every(item => !item.checked);
  const brokenJson = importedTextFile?.extension === 'json' && !sanitizedJsonIsValid(lastResult.text);
  const canShare = Boolean(lastResult.text) && !incompleteCPF && !noneEnabled && !brokenJson;
  $('copy').disabled = !canShare;
  $('download-text').disabled = !canShare;
  $('copy').textContent = t(copyFeedback === 'copied' ? 'text.copied' : copyFeedback === 'manual' ? 'text.selectCopy' : 'text.copy');
  $('char-count').textContent = t('text.characters', { count: original.length });
  const n = lastResult.hits.length;
  $('original-status').textContent = incompleteCPF ? t('text.incompleteCPF') : n ? t('text.highlights', { count: n }) : t(original ? 'text.noPatterns' : 'text.waiting');
  $('protected-status').textContent = t(noneEnabled ? 'text.disabled' : incompleteCPF ? 'text.reviewCPF' : brokenJson ? 'text.invalidJSON' : n ? 'text.replacements' : 'text.noReplacements', { count: n });
  const categories = [...new Set(lastResult.hits.map(hit => t('kind.' + hit.kind)))];
  const detailsKey = brokenJson ? 'text.jsonHelp' : noneEnabled ? 'text.disabledHelp' : incompleteCPF ? 'text.cpfHelp' : copyFeedback === 'manual' ? 'text.clipboardHelp' : n ? 'text.detected' : original ? 'text.noPatternsHelp' : 'text.noAnalysis';
  $('details').textContent = t(detailsKey, { count: n, categories: categories.join(', ') });
  let html='',pos=0;
  for(const h of lastResult.hits){html+=escapeHTML(original.slice(pos,h.start));html+=`<mark title="${escapeHTML(t('kind.' + h.kind))}">${escapeHTML(h.original)}</mark>`;pos=h.end;}
  $('highlight').innerHTML = html+escapeHTML(original.slice(pos))+'\n';
  syncScroll();
}
function syncScroll(){ $('highlight').scrollTop = input.scrollTop; $('highlight').scrollLeft = input.scrollLeft; }
input.addEventListener('input',update);
input.addEventListener('scroll',syncScroll);
for(const toggle of detectors) toggle.addEventListener('change',()=>{updateSettingsStatus();update();});
$('enable-all').addEventListener('click',()=>{for(const toggle of detectors) toggle.checked=true;updateSettingsStatus();update();});
$('clear').addEventListener('click',()=>{clearImportedTextFile();input.value='';output.value='';input.scrollTop=0;input.scrollLeft=0;update();input.focus();});
$('example').addEventListener('click',()=>{
  clearImportedTextFile();
  input.value='OPENAI_API_KEY=sk-proj-EXEMPLO_TOKEN_DE_TESTE12345\nDATABASE_URL=postgresql://admin:senha_ficticia@db.exemplo.invalid:5432/producao\nContato: contato@empresa.com.br\nTelefone: (48) 98888-7777\nEndereço: Rua das Flores, 123, Centro - São José/SC, CEP 88100-000\nCPF: 123.456.789-09\nServidor: 10.20.30.40\nAuthorization: Bearer token_de_exemplo_1234567890';
  update();input.focus();
});
$('download-text').addEventListener('click', () => {
  if ($('download-text').disabled || !output.value) return;
  const extension = importedTextFile?.extension || 'txt';
  const mime = extension === 'json' ? 'application/json' : extension === 'md' ? 'text/markdown' : 'text/plain';
  const blob = new Blob([output.value], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = protectedTextFilename(importedTextFile?.name, { suffix: t('file.suffix'), fallbackStem: t('file.stem') });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('copy').addEventListener('click',async()=>{
  if(!output.value) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(output.value);
    copyFeedback = 'copied';
    renderText();
  } catch {
    output.focus();output.select();
    copyFeedback = 'manual';
    renderText();
  }
});
updateSettingsStatus();
update();

i18n.subscribe(() => {
  translatePage(i18n, document);
  applyTheme(document.documentElement.dataset.theme);
  updateSettingsStatus();
  showFileStatus(fileError);
  renderText();
});
