/** Local PDF review. Only a complete, verified set of protected pixels can reach the writer. */
const pdfUI = id => document.getElementById(id);
const elPdf = Object.fromEntries([
  'file', 'pick', 'empty', 'ready', 'name', 'stats', 'message', 'warning', 'page', 'prev', 'next',
  'canvas', 'overlay', 'remove-layer', 'undo', 'clear', 'restore-auto', 'export', 'reviewed',
  'raster', 'restart', 'close', 'cancel',
].map(key => [key, pdfUI('pdf-' + key)]));
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_PAGES = 30;
const MAX_PAGE_PIXELS = 5_000_000;
const MAX_DOCUMENT_TEXT = 500_000;
const MAX_DOCUMENT_SEGMENTS = 50_000;
let pdfSession = null;
let pdfOperation = null;
let pdfDrag = null;
let pdfFeedback = { key: 'pdf.empty', values: {}, bad: false };

function renderPDFMessage() {
  const { key, values, bad } = pdfFeedback;
  const reason = values.errorCode ? t(values.errorCode.key, values.errorCode.values) : '';
  const message = t(key, { ...values, reason }) + (values.previous ? t('pdf.previousOpen') : '');
  for (const el of [elPdf.message, pdfUI('pdf-ready-message')]) {
    el.textContent = message;
    el.classList.toggle('pdf-error', bad);
  }
}

function pdfMessage(key, values = {}, bad = false) {
  pdfFeedback = { key, values, bad };
  renderPDFMessage();
}

function switchMode(mode) {
  for (const kind of ['text', 'pdf']) {
    const active = mode === kind;
    pdfUI(kind + '-mode').hidden = !active;
    pdfUI('mode-' + kind).classList.toggle('active', active);
    pdfUI('mode-' + kind).setAttribute('aria-selected', String(active));
  }
  if (mode === 'pdf') resizePDFPreview();
}
pdfUI('mode-text').addEventListener('click', () => switchMode('text'));
pdfUI('mode-pdf').addEventListener('click', () => switchMode('pdf'));

function assertPDF(condition, code = 'pdf.incomplete') {
  if (!condition) throw new LocalizedError(code);
}

function pageGeometry(page) {
  const base = page.getViewport({ scale: 1 });
  const { width, height } = base;
  assertPDF([width, height].every(n => Number.isFinite(n) && n >= 1 && n <= 6000), 'pdf.pageSize');
  const scale = Math.min(2, 2500 / width, 3000 / height, Math.sqrt(MAX_PAGE_PIXELS / (width * height)));
  const viewport = page.getViewport({ scale });
  return {
    base, viewport, width, height, scale, rotation: base.rotation,
    pixelWidth: Math.ceil(viewport.width), pixelHeight: Math.ceil(viewport.height),
  };
}

function clamp(value, upper) {
  return Math.max(0, Math.min(upper, value));
}

// Geometry is defined in the reviewed raster. Round outwards once for both preview and export.
function pixelBox(x1, y1, x2, y2, geometry, margin = 0) {
  const left = clamp(Math.floor(Math.min(x1, x2) - margin), geometry.pixelWidth);
  const top = clamp(Math.floor(Math.min(y1, y2) - margin), geometry.pixelHeight);
  const right = clamp(Math.ceil(Math.max(x1, x2) + margin), geometry.pixelWidth);
  const bottom = clamp(Math.ceil(Math.max(y1, y2) + margin), geometry.pixelHeight);
  if (![left, top, right, bottom].every(Number.isSafeInteger) || right <= left || bottom <= top) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function itemBox(item, style, geometry, lib) {
  const { viewport, scale } = geometry;
  const [a, b, c, d, x, y] = lib.Util.transform(viewport.transform, item.transform);
  const tangent = Math.hypot(a, b);
  const width = Math.abs(item.width) * scale * viewport.userUnit;
  if (style?.vertical || ![tangent, width].every(n => Number.isFinite(n) && n > 0)) return null;
  const advanceX = a / tangent * width;
  const advanceY = b / tangent * width;
  // Include ascent, descenders and a margin even when font metrics are approximate.
  const xs = [x + c * 1.25, x - c * 0.45, x + advanceX + c * 1.25, x + advanceX - c * 0.45];
  const ys = [y + d * 1.25, y - d * 0.45, y + advanceY + d * 1.25, y + advanceY - d * 0.45];
  return pixelBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), geometry, 3 * scale);
}

function extractPageText(content, geometry, lib) {
  let value = '';
  const segments = [];
  let previous = null;
  for (const item of content.items) {
    if (typeof item.str !== 'string' || !item.str) continue;
    const box = itemBox(item, content.styles[item.fontName], geometry, lib);
    if (previous) {
      const [a, b,,, x, y] = item.transform;
      const [pa, pb,,, px, py] = previous.transform;
      const length = Math.hypot(pa, pb);
      const dx = x - px;
      const dy = y - py;
      const gap = (dx * pa + dy * pb) / length - previous.width;
      const offset = Math.abs(dx * pb - dy * pa) / length;
      if (a !== pa || b !== pb || offset >= 5 || gap >= 2 || gap <= -4) value += ' ';
    }
    const start = value.length;
    value += item.str;
    segments.push({ start, end: value.length, box });
    previous = item;
    if (item.hasEOL) {
      value += '\n';
      previous = null;
    }
  }
  return { value, segments };
}

function findPDFHits(info, settings) {
  const { hits } = sanitize(info.value, settings);
  const boxes = new Set();
  let unmapped = false;
  let first = 0;
  for (const hit of hits) {
    while (first < info.segments.length && info.segments[first].end <= hit.start) first++;
    for (let i = first; i < info.segments.length && info.segments[i].start < hit.end; i++) {
      const { box } = info.segments[i];
      if (box) boxes.add(box);
      else unmapped = true;
    }
  }
  return { auto: [...boxes], unmapped };
}

const currentPDFPage = () => pdfSession?.pages[pdfSession.index];
const autoRectKey = rect => [rect.x, rect.y, rect.w, rect.h].join(':');
const visibleAuto = page => page.auto.filter(rect => !page.dismissedAuto.has(autoRectKey(rect)));
const activeRects = page => [...visibleAuto(page), ...page.manual];
const invalidatePDFReview = () => { elPdf.reviewed.checked = false; };

function updatePDFDetections() {
  if (!pdfSession || pdfSession.failed) return;
  if (pdfOperation?.exporting) pdfOperation.abort(new LocalizedError('pdf.cancelled'));
  const settings = detectorOptions();
  for (const page of pdfSession.pages) {
    Object.assign(page, findPDFHits(page.text, settings));
    if (page !== currentPDFPage()) page.approvalDigest = null;
  }
  invalidatePDFReview();
  drawPDFOverlay();
  updatePDFMeta();
}
for (const toggle of document.querySelectorAll('[data-detector]')) toggle.addEventListener('change', updatePDFDetections);
pdfUI('enable-all').addEventListener('click', updatePDFDetections);

function canExportPDF() {
  return Boolean(pdfSession && !pdfOperation && !pdfDrag && !pdfSession.failed &&
    pdfSession.pages.every(page => page.approvalDigest && !page.unmapped) &&
    pdfSession.pages.some(page => activeRects(page).length) && elPdf.reviewed.checked && elPdf.raster.checked);
}

function updatePDFMeta() {
  const busy = Boolean(pdfOperation);
  for (const button of [elPdf.pick, elPdf.file, elPdf.restart, elPdf.close]) button.disabled = busy;
  elPdf.cancel.hidden = !busy;
  elPdf.cancel.disabled = pdfOperation?.signal.aborted ?? false;
  elPdf.export.disabled = !canExportPDF();
  const page = currentPDFPage();
  if (!page) return;
  const { pages, index, failed } = pdfSession;
  const unviewed = pages.filter(item => !item.approvalDigest).length;
  const manual = pages.reduce((n, item) => n + item.manual.length, 0);
  const automatic = pages.reduce((n, item) => n + visibleAuto(item).length, 0);
  const removed = pages.reduce((n, item) => n + item.auto.length - visibleAuto(item).length, 0);
  const blocked = busy || failed;
  elPdf.stats.textContent = t('pdf.stats', { count: pages.length, automatic, manual }) + (removed ? t('pdf.removedCount', { count: removed }) : '');
  elPdf.page.textContent = t('pdf.page', { page: index + 1, total: pages.length });
  elPdf.prev.disabled = blocked || index === 0;
  elPdf.next.disabled = blocked || index === pages.length - 1;
  elPdf.undo.disabled = blocked || !page.manual.length;
  elPdf.clear.disabled = blocked || !manual;
  elPdf['restore-auto'].disabled = blocked || !removed;
  elPdf.reviewed.disabled = blocked || Boolean(unviewed) || pages.some(item => item.unmapped);
  elPdf.raster.disabled = blocked;
  const noText = !page.text.value.trim();
  const count = visibleAuto(page).length;
  const warning = page.unmapped ? 'pdf.unmapped' : noText ? 'pdf.noText' :
    count ? 'pdf.automatic' : page.auto.length ? 'pdf.discarded' : 'pdf.noPatterns';
  elPdf.warning.textContent = t(warning, { count });
  if (removed) elPdf.warning.textContent += t('pdf.removedWarning', { count: removed });
  if (unviewed) elPdf.warning.textContent += t('pdf.unviewed', { count: unviewed });
  elPdf.warning.classList.toggle('pdf-warning-strong', page.unmapped || !count || !!unviewed || !!removed);
}

function beginPDFOperation(timeout = 90_000) {
  pdfDrag = null;
  const operation = new AbortController();
  operation.timer = setTimeout(() => operation.abort(new LocalizedError('pdf.timeout')), timeout);
  pdfOperation = operation;
  updatePDFMeta();
  drawPDFOverlay();
  return operation;
}

function endPDFOperation(operation) {
  clearTimeout(operation.timer);
  pdfOperation = null;
  updatePDFMeta();
  drawPDFOverlay();
}

function clearCanvas(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}

async function disposePDFSession(session) {
  if (!session) return;
  // Give PDF.js a chance to clear its font/cache references, then terminate the owned port.
  let timer;
  try {
    await Promise.race([session.task?.destroy(), new Promise(resolve => { timer = setTimeout(resolve, 500); })]);
  } catch { /* Do not expose parser errors in logs. */ }
  finally {
    clearTimeout(timer);
    session.worker?.destroy();
    session.port?.terminate();
    if (session.url) URL.revokeObjectURL(session.url);
    session.pages.length = 0;
    session.document = null;
    session.task = null;
  }
}

async function renderPDFRaster(session, index, signal) {
  const info = session.pages[index];
  const page = await abortable(session.document.getPage(index + 1), signal);
  const geometry = pageGeometry(page);
  assertPDF(['width', 'height', 'pixelWidth', 'pixelHeight', 'rotation'].every(key => geometry[key] === info[key]) &&
    geometry.viewport.transform.every((n, i) => n === info.viewport.transform[i]));
  const canvas = document.createElement('canvas');
  canvas.width = geometry.pixelWidth;
  canvas.height = geometry.pixelHeight;
  try {
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    assertPDF(context);
    const task = page.render({
      canvas, viewport: geometry.viewport, annotationMode: session.lib.AnnotationMode.DISABLE,
      background: '#ffffff',
    });
    const cancel = () => task.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    try {
      await abortable(task.promise, signal);
    } finally {
      signal.removeEventListener('abort', cancel);
    }
    signal.throwIfAborted();
    assertPDF(!session.failed);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let digest;
    try { digest = await digestBytes(pixels); }
    finally { pixels.fill(0); }
    signal.throwIfAborted();
    return { canvas, context, digest };
  } catch (error) {
    clearCanvas(canvas);
    if (signal.aborted) throw signal.reason;
    throw error;
  }
}

function resizePDFPreview(page = currentPDFPage()) {
  if (!page || pdfUI('pdf-mode').hidden) return;
  const { canvas, overlay } = elPdf;
  const displayWidth = Math.min(page.width * 1.7, 790, Math.max(220, canvas.parentElement.parentElement.clientWidth - 42));
  const displayHeight = displayWidth * page.pixelHeight / page.pixelWidth;
  for (const element of [canvas, overlay]) {
    element.style.width = displayWidth + 'px';
    element.style.height = displayHeight + 'px';
  }
  renderRemoveButtons(page);
}
window.addEventListener('resize', () => resizePDFPreview());

function installPDFPreview(session, index, raster) {
  const page = session.pages[index];
  const { canvas, overlay } = elPdf;
  for (const element of [canvas, overlay]) {
    element.width = raster.canvas.width;
    element.height = raster.canvas.height;
  }
  canvas.getContext('2d', { alpha: false, willReadFrequently: true }).drawImage(raster.canvas, 0, 0);
  session.index = index;
  page.approvalDigest = raster.digest;
}

async function loadPDF(file) {
  if (!file || pdfOperation) return;
  if (file.size > MAX_PDF_BYTES) return pdfMessage('pdf.size', {}, true);
  if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    return pdfMessage('pdf.select', {}, true);
  }
  const operation = beginPDFOperation();
  const { signal } = operation;
  const previous = pdfSession;
  const candidate = { pages: [], index: 0, failed: false };
  let raster;
  let buffer;
  try {
    pdfMessage('pdf.reading');
    const lib = globalThis.pdfjsLib;
    assertPDF(lib?.version === '6.5.438', 'pdf.readerError');
    candidate.lib = lib;
    const reading = file.arrayBuffer().then(bytes => {
      const input = new Uint8Array(bytes);
      if (signal.aborted) input.fill(0);
      signal.throwIfAborted();
      return input;
    });
    buffer = await abortable(reading, signal);
    signal.throwIfAborted();
    pdfMessage('pdf.preparing');
    Object.assign(candidate, await createOfflinePDFWorker());
    const markIncomplete = () => {
      candidate.failed = true;
      if (pdfSession === candidate && !pdfOperation) {
        invalidatePDFReview();
        pdfMessage('pdf.incomplete', {}, true);
        updatePDFMeta();
      }
    };
    candidate.port.addEventListener('error', event => {
      event.preventDefault();
      markIncomplete();
      if (pdfSession === candidate || pdfOperation === operation) pdfOperation?.abort(new LocalizedError('pdf.incomplete'));
    });
    candidate.port.addEventListener('message', ({ data }) => {
      if (data?.type === 'safepaste-incomplete') markIncomplete();
    });
    signal.throwIfAborted();
    candidate.worker = new lib.PDFWorker({ port: candidate.port, verbosity: 1 });
    candidate.task = lib.getDocument({ ...offlinePDFOptions, data: buffer, worker: candidate.worker });
    candidate.document = await abortable(candidate.task.promise, signal);
    const { numPages } = candidate.document;
    assertPDF(Number.isInteger(numPages) && numPages > 0 && numPages <= MAX_PAGES, 'pdf.pageLimit');
    let characters = 0;
    let segments = 0;
    for (let number = 1; number <= numPages; number++) {
      pdfMessage('pdf.analyzing', { page: number, total: numPages });
      const page = await abortable(candidate.document.getPage(number), signal);
      const geometry = pageGeometry(page);
      const content = await abortable(page.getTextContent(), signal);
      const text = extractPageText(content, geometry, lib);
      characters += text.value.length;
      segments += text.segments.length;
      assertPDF(characters <= MAX_DOCUMENT_TEXT && segments <= MAX_DOCUMENT_SEGMENTS, 'pdf.textLimit');
      candidate.pages.push({ ...geometry, text, manual: [], dismissedAuto: new Set() });
    }
    const settings = detectorOptions();
    for (const page of candidate.pages) Object.assign(page, findPDFHits(page.text, settings));
    raster = await renderPDFRaster(candidate, 0, signal);
    signal.throwIfAborted();
    elPdf.empty.hidden = true;
    elPdf.ready.hidden = false;
    installPDFPreview(candidate, 0, raster);
    pdfSession = candidate;
    resizePDFPreview();
    elPdf.name.textContent = file.name;
    elPdf.raster.checked = false;
    invalidatePDFReview();
    pdfMessage('pdf.ready');
    await disposePDFSession(previous);
  } catch (error) {
    await disposePDFSession(candidate);
    if (error?.code === 'pdf.cancelled') pdfMessage('pdf.cancelled', { previous: Boolean(previous) });
    else pdfMessage('pdf.openError', { errorCode: pdfErrorCode(error), previous: Boolean(previous) }, true);
    if (!previous) { elPdf.ready.hidden = true; elPdf.empty.hidden = false; }
  } finally {
    if (buffer?.byteLength) buffer.fill(0);
    if (raster) clearCanvas(raster.canvas);
    endPDFOperation(operation);
  }
}

function pdfErrorCode(error) {
  if (error instanceof LocalizedError) return { key: error.code, values: error.values };
  if (error?.name === 'InvalidPDFException') return { key: 'pdf.invalid' };
  if (error?.name === 'PasswordException') return { key: 'pdf.password' };
  return { key: 'error.unknown' };
}

async function showPDFPage(index) {
  const session = pdfSession;
  if (!session || session.failed || pdfOperation || !session.pages[index]) return;
  const operation = beginPDFOperation();
  let raster;
  try {
    raster = await renderPDFRaster(session, index, operation.signal);
    operation.signal.throwIfAborted();
    installPDFPreview(session, index, raster);
    resizePDFPreview();
    pdfMessage('pdf.ready');
  } catch (error) {
    session.pages[index].approvalDigest = null;
    invalidatePDFReview();
    if (error?.code === 'pdf.cancelled') pdfMessage('pdf.cancelled');
    else pdfMessage('pdf.previewError', { errorCode: pdfErrorCode(error) }, true);
  } finally {
    if (raster) clearCanvas(raster.canvas);
    endPDFOperation(operation);
  }
}

async function closePDF() {
  if (pdfOperation || !pdfSession) return;
  const session = pdfSession;
  const operation = beginPDFOperation();
  pdfSession = null;
  for (const element of [elPdf.name, elPdf.stats, elPdf.warning, elPdf.page]) element.textContent = '';
  elPdf.file.value = '';
  elPdf.ready.hidden = true;
  elPdf.empty.hidden = false;
  elPdf.raster.checked = false;
  invalidatePDFReview();
  clearCanvas(elPdf.canvas);
  clearCanvas(elPdf.overlay);
  elPdf['remove-layer'].replaceChildren();
  pdfMessage('pdf.closed');
  await disposePDFSession(session);
  endPDFOperation(operation);
}

elPdf.file.addEventListener('change', () => {
  const file = elPdf.file.files?.[0];
  elPdf.file.value = '';
  void loadPDF(file);
});
elPdf.pick.addEventListener('click', () => elPdf.file.click());
elPdf.restart.addEventListener('click', () => elPdf.file.click());
elPdf.close.addEventListener('click', closePDF);
elPdf.cancel.addEventListener('click', () => {
  pdfOperation?.abort(new LocalizedError('pdf.cancelled'));
  updatePDFMeta();
});
elPdf.prev.addEventListener('click', () => showPDFPage(pdfSession.index - 1));
elPdf.next.addEventListener('click', () => showPDFPage(pdfSession.index + 1));

function paintPDFRects(context, rects) {
  context.fillStyle = '#000';
  for (const { x, y, w, h } of rects) context.fillRect(x, y, w, h);
}

function drawPDFOverlay() {
  const page = currentPDFPage();
  if (!page) return;
  const { overlay } = elPdf;
  const context = overlay.getContext('2d', { willReadFrequently: true });
  context.clearRect(0, 0, overlay.width, overlay.height);
  paintPDFRects(context, activeRects(page));
  if (pdfDrag) {
    const box = dragBox();
    if (box) {
      context.fillStyle = 'rgba(41,129,76,.55)';
      context.fillRect(box.x, box.y, box.w, box.h);
    }
  }
  renderRemoveButtons(page);
}

function renderRemoveButtons(page) {
  const layer = elPdf['remove-layer'];
  layer.replaceChildren();
  const { width, height } = elPdf.overlay.getBoundingClientRect();
  const rects = [
    ...visibleAuto(page).map(rect => ({ rect, automatic: true })),
    ...page.manual.map((rect, index) => ({ rect, index })),
  ];
  for (const { rect, automatic, index } of rects) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pdf-remove-rect';
    button.textContent = '×';
    button.disabled = Boolean(pdfOperation || pdfSession.failed || pdfDrag);
    button.title = t(automatic ? 'pdf.removeAuto' : 'pdf.removeManual');
    button.setAttribute('aria-label', t('pdf.removeLabel', { action: button.title, page: pdfSession.index + 1 }));
    button.style.left = clamp((rect.x + rect.w) / page.pixelWidth * width - 18, Math.max(0, width - 22)) + 'px';
    button.style.top = clamp(rect.y / page.pixelHeight * height + 2, Math.max(0, height - 22)) + 'px';
    button.addEventListener('click', () => changePDFRects(() => {
      if (automatic) page.dismissedAuto.add(autoRectKey(rect));
      else page.manual.splice(index, 1);
    }));
    layer.appendChild(button);
  }
}

function changePDFRects(change) {
  if (!pdfSession || pdfSession.failed || pdfOperation || pdfDrag) return;
  change();
  invalidatePDFReview();
  drawPDFOverlay();
  updatePDFMeta();
}

function pdfCursor(event) {
  const { overlay } = elPdf;
  const bounds = overlay.getBoundingClientRect();
  return {
    x: clamp((event.clientX - bounds.left) * overlay.width / bounds.width, overlay.width),
    y: clamp((event.clientY - bounds.top) * overlay.height / bounds.height, overlay.height),
  };
}

function dragBox() {
  const { start, end } = pdfDrag;
  return pixelBox(start.x, start.y, end.x, end.y, currentPDFPage());
}

elPdf.overlay.addEventListener('pointerdown', event => {
  if (!currentPDFPage() || pdfOperation || pdfSession.failed || pdfDrag || event.button !== 0) return;
  event.preventDefault();
  const point = pdfCursor(event);
  pdfDrag = { pointer: event.pointerId, start: point, end: point };
  elPdf.overlay.setPointerCapture(event.pointerId);
  updatePDFMeta();
});
elPdf.overlay.addEventListener('pointermove', event => {
  if (pdfDrag?.pointer !== event.pointerId) return;
  pdfDrag.end = pdfCursor(event);
  drawPDFOverlay();
});
elPdf.overlay.addEventListener('pointerup', event => {
  if (pdfDrag?.pointer !== event.pointerId) return;
  pdfDrag.end = pdfCursor(event);
  const box = dragBox();
  pdfDrag = null;
  if (box && box.w >= 3 && box.h >= 3) changePDFRects(() => currentPDFPage().manual.push(box));
  else { drawPDFOverlay(); updatePDFMeta(); }
});
for (const type of ['pointercancel', 'lostpointercapture']) {
  elPdf.overlay.addEventListener(type, event => {
    if (pdfDrag?.pointer !== event.pointerId) return;
    pdfDrag = null;
    drawPDFOverlay();
    updatePDFMeta();
  });
}
elPdf.undo.addEventListener('click', () => changePDFRects(() => currentPDFPage().manual.pop()));
elPdf.clear.addEventListener('click', () => changePDFRects(() => { for (const page of pdfSession.pages) page.manual = []; }));
elPdf['restore-auto'].addEventListener('click', () => changePDFRects(() => { for (const page of pdfSession.pages) page.dismissedAuto.clear(); }));
for (const element of [elPdf.reviewed, elPdf.raster]) element.addEventListener('change', updatePDFMeta);

async function generatePDF() {
  if (!canExportPDF() || !window.confirm(t('pdf.confirm'))) return;
  const session = pdfSession;
  const approved = session.pages.map(page => ({
    digest: page.approvalDigest, rects: activeRects(page).map(rect => ({ ...rect })),
  }));
  const operation = beginPDFOperation(180_000);
  operation.exporting = true;
  const { signal } = operation;
  const pages = [];
  let compressedBytes = 0;
  let pageInProgress = null;
  try {
    for (const [index, selection] of approved.entries()) {
      pageInProgress = session.pages[index];
      pdfMessage('pdf.generating', { page: index + 1, total: approved.length });
      const raster = await renderPDFRaster(session, index, signal);
      const { canvas, context } = raster;
      try {
        assertPDF(raster.digest === selection.digest, 'pdf.changedRender');
        const { pixelWidth, pixelHeight, width, height } = session.pages[index];
        paintPDFRects(context, selection.rects);
        const pixels = context.getImageData(0, 0, pixelWidth, pixelHeight).data;
        const rgbDeflate = await compressRedactedPixels(pixels);
        pages.push({ rgbDeflate, pixelWidth, pixelHeight, width, height });
        compressedBytes += rgbDeflate.length;
        assertPDF(compressedBytes <= MAX_RASTER_BYTES, 'pdf.outputLimit');
      } finally {
        clearCanvas(canvas);
      }
      signal.throwIfAborted();
    }
    pageInProgress = null;
    assertPDF(pages.length === approved.length && !session.failed);
    const result = buildRasterPDF(pages);
    const url = URL.createObjectURL(new Blob([result], { type: 'application/pdf' }));
    result.fill(0);
    const link = document.createElement('a');
    link.href = url;
    link.download = t('file.pdfName');
    document.body.append(link);
    try { link.click(); }
    finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    pdfMessage('pdf.generated');
  } catch (error) {
    invalidatePDFReview();
    if (pageInProgress && error?.code !== 'pdf.cancelled') pageInProgress.approvalDigest = null;
    if (error?.code === 'pdf.cancelled') pdfMessage('pdf.cancelled');
    else pdfMessage('pdf.exportError', { errorCode: pdfErrorCode(error) }, true);
  } finally {
    for (const page of pages) page.rgbDeflate.fill(0);
    endPDFOperation(operation);
  }
}
elPdf.export.addEventListener('click', generatePDF);

i18n.subscribe(() => {
  renderPDFMessage();
  updatePDFMeta();
  if (currentPDFPage()) renderRemoveButtons(currentPDFPage());
});
renderPDFMessage();
updatePDFMeta();
