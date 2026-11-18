import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const root = new URL('../vendor/pdfjs/', import.meta.url);
const read = path => readFileSync(new URL(path, root));
const manifest = JSON.parse(read('integrity.json'));
const compatibility = readFileSync(new URL('../src/pdf-compat.js', import.meta.url), 'utf8');
const adaptPDFSum = source => source.replaceAll('Math.sumPrecise(', 'sumPDFNumbers(');
if (manifest.version !== '6.5.438') throw new Error('Update the reviewed PDF.js version and adapter together.');
const files = Object.fromEntries(Object.entries(manifest.files).map(([path, expected]) => {
  const content = read(path);
  if (createHash('sha256').update(content).digest('hex') !== expected) {
    throw new Error(`PDF.js integrity mismatch: ${path}`);
  }
  return [path, content];
}));

const resources = Object.fromEntries(Object.entries(files)
  .filter(([path]) => /\.(bcmap|pfb|ttf|wasm|icc)$/.test(path))
  .map(([path, bytes]) => [path, bytes.toString('base64')]));
let worker = files['pdf.worker.mjs'].toString();
function adapt(pattern, replacement) {
  if (!pattern.test(worker)) throw new Error(`Reassess PDF.js offline adapter: ${pattern}`);
  worker = worker.replace(pattern, () => replacement);
}
// Replace only the pinned worker's asset loaders. There is no URL resolution
// or fallback import for PDF-supplied names. Keep the upstream files pristine.
adapt(/async function fetchBinaryData\(url\) \{[\s\S]*?\n\}/,
  'async function fetchBinaryData(url) { return new Uint8Array(offlineAsset(url)); }');
adapt(/function fetchSync\(url\) \{[\s\S]*?\n\}/,
  'function fetchSync(url) { return offlineAsset(url); }');
adapt(/async #getJsInstance\(imports\) \{[\s\S]*?\n  \}/,
  'async #getJsInstance() { throw new Error("Offline decoder unavailable"); }');
// The display API can resolve an incomplete render after the operator stream
// errors once graphics have started. Report failure separately before closing it.
const operators = worker.match(/    handler.on\("GetOperatorList",[\s\S]*?(?=    handler.on\("GetTextContent")/)?.[0];
if (!operators || !operators.includes('sink.error(reason);')) throw new Error('Reassess PDF.js operator failure handling.');
worker = worker.replace(operators, () => operators.replace('sink.error(reason);',
  'postMessage({ type: "safepaste-incomplete" });\n          sink.error(reason);'));
// A classic blob Worker works in Chromium offline mode, where module blob
// worker startup can fail before the parser runs. There are no module imports.
adapt(/^export \{ WorkerMessageHandler \};$/m, '');
worker = worker.replaceAll('import.meta.url', 'globalThis.location.href');
const quietConsole = 'const console = Object.freeze({log(){}, info(){}, warn(){}, error(){}, debug(){}});';
const embeddedWorker = Buffer.from(`
${compatibility}
const console = Object.freeze({
  log(){}, info(){}, debug(){},
  warn(){ postMessage({ type: "safepaste-incomplete" }); },
  error(){ postMessage({ type: "safepaste-incomplete" }); }
});
const offlineAssets = ${JSON.stringify(resources)};
function offlineAsset(key) {
  if (!Object.hasOwn(offlineAssets, key)) throw new Error("Unknown offline PDF resource");
  return Uint8Array.fromBase64(offlineAssets[key]).buffer;
}
// Any remaining native fetch path fails before it can reach the network.
const fetch = () => Promise.reject(new Error("Network disabled in PDF worker"));
${adaptPDFSum(worker.replace(/^\/\/# sourceMappingURL=.*$/gm, ''))}
`);
export const pdfWorkerBase64 = gzipSync(embeddedWorker, { level: 9 }).toString('base64');
export const pdfWorkerDigest = createHash('sha256').update(embeddedWorker).digest('hex');
export const pdfLibrary = `\n${quietConsole}\n${compatibility}\n${adaptPDFSum(files['pdf.min.mjs'].toString())}\n`.replace(/<\/script/gi, '<\\/script');
export const pdfLicenseNotices = Object.entries(files)
  .filter(([path]) => path.includes('LICENSE'))
  .map(([path, bytes]) => {
    const component = path.endsWith('LICENSE_LIBERATION')
      ? `Liberation Sans ${manifest.liberationSans.version}`
      : `PDF.js ${manifest.version}`;
    return `${component} / ${path}\n\n${bytes.toString()}`;
  }).join('\n\n');
