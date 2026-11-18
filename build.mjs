import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { enUS } from './src/locales/en-US.js';
import { pdfLibrary, pdfLicenseNotices, pdfWorkerBase64, pdfWorkerDigest } from './tools/embed-pdfjs.mjs';

const file = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = file('./src/styles.css');
// Explicit dependency order; only our own named imports/exports are bundled.
const modules = [
  'locales/en-US.js', 'locales/pt-BR.js', 'i18n.js', 'sanitize.js',
  'text-files.js', 'app.js', 'pdf-build.js', 'pdf-offline.js', 'pdf-mode.js',
];
const bundle = modules.map(path => file(`./src/${path}`)
  .replace(/^import \{[^}]+\} from '\.[^']+';\r?\n/gm, '')
  .replace(/\bexport\s+(?=(?:async function|function|const|class)\s)/g, '')).join('\n');
// Prevent a future translation/example from terminating an inline script.
const js = `\nconst PDF_WORKER_DIGEST = '${pdfWorkerDigest}';\n${bundle.replace(/<\/script/gi, '<\\/script')}\n`;
const hash = s => createHash('sha256').update(s).digest('base64');
const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function english(key) {
  if (typeof enUS[key] !== 'string') throw new Error(`Missing static English translation: ${key}`);
  return escape(enUS[key]);
}
let html = file('./src/index.html');
html = html.replace(/(<([\w-]+)\b[^>]*\bdata-i18n="([^"]+)"[^>]*>)[^<>]*(<\/\2>)/g,
  (_, open, tag, key, close) => open + english(key) + close);
html = html.replace(/<[^>]+\bdata-i18n-(?:aria-label|placeholder|title|content)="[^"]+"[^>]*>/g, tag => {
  for (const [, attribute, key] of tag.matchAll(/data-i18n-(aria-label|placeholder|title|content)="([^"]+)"/g)) {
    tag = tag.replace(new RegExp(`(?<![\\w-])${attribute}="[^"]*"`), () => `${attribute}="${english(key)}"`);
  }
  return tag;
});
html = html.replace('<!-- styles -->', () => `<style>${css}</style>`);
html = html.replace('<!-- PDF license notices -->', () => escape(pdfLicenseNotices.replace(/[ \t]+$/gm, '')));
html = html.replace('<!-- scripts -->', () =>
  `<script type="application/octet-stream" id="pdf-worker-data">${pdfWorkerBase64}</script>\n` +
  `<script type="module">${pdfLibrary}</script>\n<script>${js}</script>`);
const csp = `default-src 'none'; script-src 'sha256-${hash(js)}' 'sha256-${hash(pdfLibrary)}' 'wasm-unsafe-eval'; style-src 'sha256-${hash(css)}'; img-src data: blob:; font-src data: blob:; worker-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
html = html.replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(">)/, (_, start, end) => start + csp + end);
writeFileSync(new URL('./index.html', import.meta.url), html);
console.log('Built standalone offline index.html.');
