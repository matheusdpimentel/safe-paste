const MAX_PDF_IMAGE_PIXELS = 24_000_000;
let verifiedWorkerBytes;

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    const cleanup = () => signal.removeEventListener('abort', abort);
    Promise.resolve(promise).then(
      value => { cleanup(); resolve(value); },
      error => { cleanup(); reject(error); },
    );
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

async function digestBytes(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function createOfflinePDFWorker() {
  if (!verifiedWorkerBytes) {
    const encoded = document.getElementById('pdf-worker-data').textContent;
    const compressed = Uint8Array.fromBase64(encoded);
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    if (await digestBytes(bytes) !== PDF_WORKER_DIGEST) throw new LocalizedError('pdf.readerError');
    verifiedWorkerBytes = bytes;
  }
  const url = URL.createObjectURL(new Blob([verifiedWorkerBytes], { type: 'text/javascript' }));
  try {
    return { port: new Worker(url), url };
  } catch {
    URL.revokeObjectURL(url);
    throw new LocalizedError('pdf.readerError');
  }
}

const offlinePDFOptions = Object.freeze({
  // These are keys into the worker's embedded resource table.
  cMapUrl: 'cmaps/',
  standardFontDataUrl: 'standard_fonts/',
  wasmUrl: 'wasm/',
  iccUrl: 'iccs/',
  useWorkerFetch: true,
  useWasm: true,
  enableXfa: false,
  isEvalSupported: false,
  disableWorkerRendering: true,
  isImageDecoderSupported: false,
  isOffscreenCanvasSupported: false,
  // Render font outlines on canvas instead of installing PDF-supplied font
  // faces or creating stylesheet rules in the browser document.
  disableFontFace: true,
  useSystemFonts: false,
  stopAtErrors: true,
  maxImageSize: MAX_PDF_IMAGE_PIXELS,
  verbosity: 0,
});
