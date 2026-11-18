/** SafePaste PDF beta: client-side rasterization, automatic candidates, manual review. */
const pdfUI = id => document.getElementById(id);
const pdfState = { document: null, loadingTask: null, pages: [], index: 0, pdfjs: null, manualMode: true, previewScale: 1, dragging: null, busy: false, sourceName: '', previewTask: null };
const MAX_PDF_BYTES = 25 * 1024 * 1024, MAX_PAGES = 30;
const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.mjs';
const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.worker.mjs';
let pdfjsPromise;
const elPdf = Object.fromEntries([
  'file','pick','empty','ready','name','stats','message','warning','page','prev','next',
  'canvas','overlay','remove-layer','undo','clear','restore-auto','export','reviewed','raster','progress','restart'
].map(k => [k,pdfUI('pdf-'+k)]));

let pdfFeedback = { key: 'pdf.empty', values: {}, bad: false };
function renderPDFMessage() {
  const { key, values, bad } = pdfFeedback;
  const reason = values.error ? translatedError(values.error, i18n) : '';
  const message = t(key, { ...values, reason }) + (values.previous ? t('pdf.previousOpen') : '');
  for (const el of [elPdf.message, pdfUI('pdf-ready-message')]) {
    if (!el) continue;
    el.textContent = message;
    el.classList.toggle('pdf-error', bad);
  }
}
function pdfMessage(key, values = {}, bad = false) {
  pdfFeedback = { key, values, bad };
  renderPDFMessage();
}
function switchMode(mode) {
  const isPDF = mode === 'pdf';
  pdfUI('text-mode').hidden = isPDF;
  pdfUI('pdf-mode').hidden = !isPDF;
  pdfUI('mode-text').classList.toggle('active', !isPDF);
  pdfUI('mode-pdf').classList.toggle('active', isPDF);
  pdfUI('mode-text').setAttribute('aria-selected', String(!isPDF));
  pdfUI('mode-pdf').setAttribute('aria-selected', String(isPDF));
}
pdfUI('mode-text').addEventListener('click', () => switchMode('text'));
pdfUI('mode-pdf').addEventListener('click', () => switchMode('pdf'));
function normalizeRect(r) {
  const x = Math.min(r.x, r.x + r.w), y = Math.min(r.y, r.y + r.h);
  return {x: Math.max(0, x), y: Math.max(0,y), w: Math.abs(r.w), h: Math.abs(r.h)};
}
function boundRect(r, pw, ph) {
  const x = Math.max(0, Math.min(pw, r.x - 3));
  const y = Math.max(0, Math.min(ph, r.y - 3));
  const x2 = Math.max(x, Math.min(pw, r.x + r.w + 3));
  const y2 = Math.max(y, Math.min(ph, r.y + r.h + 3));
  return {x, y, w:x2-x, h:y2-y};
}
function itemBox(item, viewport, pdfjs) {
  const transform = pdfjs.Util.transform(viewport.transform, item.transform);
  const fontHeight = Math.max(4, Math.hypot(transform[2], transform[3]));
  const w = Math.max(2, Math.abs(item.width));
  const h = Math.max(fontHeight, Math.abs(item.height), 6);
  // Conservative: cover entire text run containing the sensitive substring.
  const x = transform[4], y = transform[5] - h;
  if (Math.abs(transform[1]) > 0.025 || Math.abs(transform[2]) > 0.025) return null;
  return boundRect({x,y,w,h:h*1.25}, viewport.width,viewport.height);
}
function extractPageSegments(items, viewport, pdfjs) {
  let value = '';
  const segments=[];
  let prev = null;
  for(const item of items) {
    if(typeof item.str !== 'string' || !item.str) continue;
    const box = itemBox(item,viewport,pdfjs);
    const gap = prev && box && Math.abs(prev.y-box.y) < 5 ? box.x - (prev.x+prev.w) : 100;
    const sep = prev ? (gap < 2 && gap > -4 ? '' : ' ') : '';
    value += sep;
    const start=value.length;
    value += item.str;
    segments.push({start,end:value.length,box});
    prev=box;
    if(item.hasEOL) {value+='\n';prev=null;}
  }
  return {value,segments};
}
function findPDFHits(info) {
  const detection = detectorOptions();
  const result = sanitize(info.value, detection);
  const boxes=[];
  for (const hit of result.hits) {
    for (const seg of info.segments) {
      if (seg.box && hit.start < seg.end && hit.end > seg.start) {
        if (!boxes.some(b=>b.segment===seg)) boxes.push({segment:seg, ...seg.box});
      }
    }
  }
  return { boxes: boxes.map(({segment,...rect}) => rect), hitCount:result.hits.length };
}
function updatePDFDetections() {
  if(!pdfState.pages.length) return;
  for(const page of pdfState.pages) {
    const found=findPDFHits(page.text);
    page.auto=found.boxes;
    page.hitCount=found.hitCount;
    page.viewed=false;
  }
  invalidateReview();
  pdfState.pages[pdfState.index].viewed=true;
  updatePDFMeta(); drawOverlay();
}
for (const input of document.querySelectorAll('[data-detector]')) input.addEventListener('change', updatePDFDetections);
pdfUI('enable-all').addEventListener('click', () => setTimeout(updatePDFDetections,0));
// A removed automatic suggestion stays removed even if detections are recalculated.
// Stable geometry keys also avoid relying on indexes that can change by category.
function autoRectKey(r) {return [r.x,r.y,r.w,r.h].map(n=>Math.round(n*100)).join(':');}
function visibleAuto(page) {return page.auto.filter(r=>!page.dismissedAuto.has(autoRectKey(r)));}
function totalBoxes() {return pdfState.pages.reduce((n,p)=>n+visibleAuto(p).length+p.manual.length,0);}
function removedAutoCount() {return pdfState.pages.reduce((n,p)=>n+p.auto.filter(r=>p.dismissedAuto.has(autoRectKey(r))).length,0);}
function invalidateReview() {elPdf.reviewed.checked=false;}

function updatePDFMeta() {
  const pages=pdfState.pages;
  if (!pages.length) return;
  const current=pages[pdfState.index];
  const unviewed=pages.filter(p=>!p.viewed).length;
  const manually=pages.reduce((n,p)=>n+p.manual.length,0);
  const activeAutomatic=pages.reduce((n,p)=>n+visibleAuto(p).length,0);
  const removed=removedAutoCount();
  elPdf.stats.textContent=t('pdf.stats', { count: pages.length, automatic: activeAutomatic, manual: manually }) + (removed ? t('pdf.removedCount', { count: removed }) : '');
  elPdf.page.textContent=t('pdf.page', { page: pdfState.index+1, total: pages.length });
  elPdf.prev.disabled=pdfState.index===0 || pdfState.busy;
  elPdf.next.disabled=pdfState.index===pages.length-1 || pdfState.busy;
  elPdf.undo.disabled=pdfState.busy || !current.manual.length;
  elPdf.clear.disabled=pdfState.busy || !pages.some(p=>p.manual.length);
  elPdf['restore-auto'].disabled=pdfState.busy || !removed;
  elPdf.export.disabled=pdfState.busy || !totalBoxes() || !!unviewed || !elPdf.reviewed.checked || !elPdf.raster.checked;
  const hasNoText=!current.text.value.trim();
  const activeOnPage=visibleAuto(current).length;
  const discardedOnPage=current.auto.length-activeOnPage;
  elPdf.warning.textContent = t(hasNoText ? 'pdf.noText' : activeOnPage ? 'pdf.automatic' : discardedOnPage ? 'pdf.discarded' : 'pdf.noPatterns', { count: activeOnPage });
  if (removed) elPdf.warning.textContent += t('pdf.removedWarning', { count: removed });
  if (unviewed) elPdf.warning.textContent += t('pdf.unviewed', { count: unviewed });
  elPdf.warning.classList.toggle('pdf-warning-strong',hasNoText || !activeOnPage || !!unviewed || !!removed);
}
async function ensurePdfjs() {
  if(!pdfjsPromise) pdfjsPromise = import(PDFJS_URL).then(lib => {
    lib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER_URL;
    return lib;
  }).catch(error => {pdfjsPromise=null;throw new LocalizedError('pdf.readerError');});
  return pdfjsPromise;
}
function setBusy(busy) {
  pdfState.busy=busy;
  elPdf.pick.disabled=busy;
  elPdf.file.disabled=busy;
  elPdf.restart.disabled=busy;
  updatePDFMeta();
}
function pageViewportFor(canvas,base,limit=1500) {
  const displayWidth=Math.min(790, Math.max(250, elPdf.canvas.parentElement.parentElement.clientWidth-42));
  const scale=Math.min(1.7, displayWidth/base.width, limit/base.width, limit/base.height);
  return Math.max(0.15,scale);
}
async function showPDFPage(index, allowWhileBusy = false) {
  if(!pdfState.document || (pdfState.busy && !allowWhileBusy)) return;
  pdfState.index=index;
  const info=pdfState.pages[index];
  const page=await pdfState.document.getPage(index+1);
  const scale=pageViewportFor(elPdf.canvas,info);
  const viewport=page.getViewport({scale});
  pdfState.previewScale=scale;
  elPdf.canvas.width=Math.ceil(viewport.width);
  elPdf.canvas.height=Math.ceil(viewport.height);
  elPdf.overlay.width=elPdf.canvas.width;
  elPdf.overlay.height=elPdf.canvas.height;
  elPdf['remove-layer'].style.width=elPdf.canvas.width+'px';
  elPdf['remove-layer'].style.height=elPdf.canvas.height+'px';
  elPdf.canvas.style.width=elPdf.overlay.style.width=elPdf.canvas.width+'px';
  elPdf.canvas.style.height=elPdf.overlay.style.height=elPdf.canvas.height+'px';
  const ctx=elPdf.canvas.getContext('2d',{alpha:false});
  ctx.fillStyle='#fff';ctx.fillRect(0,0,elPdf.canvas.width,elPdf.canvas.height);
  await page.render({canvas:elPdf.canvas,viewport}).promise;
  info.viewed=true;
  drawOverlay();updatePDFMeta();
}
/**
 * PDF.js returns a PDFDocumentLoadingTask from getDocument().
 * Its destroy() is the supported resource-cleanup API; do not assume
 * the resolved PDFDocumentProxy exposes destroy() in every PDF.js version.
 */
async function disposePDFTask(task) {
  if(!task || typeof task.destroy !== 'function') return;
  try { await task.destroy(); }
  catch(error) { console.warn('Could not release the previous PDF reader:', error); }
}
async function loadPDF(file) {
  if(!file || pdfState.busy) return;
  if(file.size>MAX_PDF_BYTES) {pdfMessage('pdf.size', {}, true);return;}
  if(file.type && file.type!=='application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {pdfMessage('pdf.select', {}, true);return;}

  let newTask = null;
  let previous = null;
  let installed = false;
  setBusy(true);
  pdfMessage('pdf.preparing');
  // Keep the previous document visible until the new one is fully ready.
  // If parsing fails, users can still review and export the previous file.
  try {
    const lib=await ensurePdfjs();
    const buffer=new Uint8Array(await file.arrayBuffer());
    pdfMessage('pdf.reading');
    // The PDF bytes remain local. Retain the loading task for proper cleanup.
    newTask=lib.getDocument({data:buffer,isEvalSupported:false,useSystemFonts:true,stopAtErrors:true});
    const documentPDF=await newTask.promise;
    if(documentPDF.numPages>MAX_PAGES) throw new LocalizedError('pdf.pageLimit');

    const all=[];
    for(let i=1;i<=documentPDF.numPages;i++) {
      pdfMessage('pdf.analyzing', { page: i, total: documentPDF.numPages });
      const page=await documentPDF.getPage(i);
      const viewport=page.getViewport({scale:1});
      if(viewport.width>6000 || viewport.height>6000) throw new LocalizedError('pdf.pageSize');
      const tc=await page.getTextContent();
      const text=extractPageSegments(tc.items,viewport,lib);
      const found=findPDFHits(text);
      all.push({width:viewport.width,height:viewport.height,text,auto:found.boxes,dismissedAuto:new Set(),hitCount:found.hitCount,manual:[],viewed:false});
    }

    previous={
      document:pdfState.document,loadingTask:pdfState.loadingTask,
      pdfjs:pdfState.pdfjs,pages:pdfState.pages,index:pdfState.index,
      sourceName:pdfState.sourceName, reviewed:elPdf.reviewed.checked, raster:elPdf.raster.checked
    };
    pdfState.document=documentPDF;pdfState.loadingTask=newTask;
    pdfState.pdfjs=lib;pdfState.pages=all;pdfState.index=0;
    pdfState.sourceName=file.name;pdfState.dragging=null;
    elPdf.name.textContent=file.name;
    elPdf.reviewed.checked=false;elPdf.raster.checked=false;
    elPdf.empty.hidden=true;elPdf.ready.hidden=false;
    // Rendering is part of the replacement transaction: if it fails,
    // restore the previously opened document instead of leaving a broken UI.
    await showPDFPage(0,true);
    installed=true;
    pdfMessage('pdf.ready');
    await disposePDFTask(previous.loadingTask);
  } catch(err) {
    console.error('PDF:',err);
    if(previous && !installed) {
      pdfState.document=previous.document;pdfState.loadingTask=previous.loadingTask;
      pdfState.pdfjs=previous.pdfjs;pdfState.pages=previous.pages;
      pdfState.index=previous.index;pdfState.sourceName=previous.sourceName;
      pdfState.dragging=null;
      elPdf.name.textContent=previous.sourceName;
      elPdf.reviewed.checked=previous.reviewed;elPdf.raster.checked=previous.raster;
      elPdf.empty.hidden=!!previous.document;
      elPdf.ready.hidden=!previous.document;
      if(previous.document) {
        try { await showPDFPage(previous.index,true); }
        catch(restoreErr) { console.warn('Could not restore the previous preview:',restoreErr); }
      }
    }
    if(newTask && !installed) await disposePDFTask(newTask);
    pdfMessage('pdf.openError', { error: err, previous: Boolean(pdfState.document) }, true);
  } finally {
    setBusy(false);
  }
}
// Clear the file input even when selecting the same PDF again.
elPdf.file.addEventListener('change',()=>{
  const file=elPdf.file.files?.[0];
  elPdf.file.value='';
  void loadPDF(file);
});
elPdf.pick.addEventListener('click',()=>elPdf.file.click());
elPdf.restart.addEventListener('click',()=>{elPdf.file.value='';elPdf.file.click();});
elPdf.prev.addEventListener('click',()=>showPDFPage(pdfState.index-1));
elPdf.next.addEventListener('click',()=>showPDFPage(pdfState.index+1));
function drawOverlay() {
  const ctx=elPdf.overlay.getContext('2d');
  ctx.clearRect(0,0,elPdf.overlay.width,elPdf.overlay.height);
  const page=pdfState.pages[pdfState.index]; if(!page) return;
  for(const r of visibleAuto(page)) drawRect(ctx,r,'rgba(31,45,36,.72)',pdfState.previewScale);
  for(const r of page.manual) drawRect(ctx,r,'rgba(32,49,39,.8)',pdfState.previewScale);
  if(pdfState.dragging) {
    const r=normalizeRect(pdfState.dragging);
    drawRect(ctx,r,'rgba(41,129,76,.55)',pdfState.previewScale);
  }
  renderRemoveButtons(page);
}
function renderRemoveButtons(page) {
  const layer=elPdf['remove-layer'];
  layer.replaceChildren();
  const buttons=[];
  for(const r of visibleAuto(page)) buttons.push({rect:r,automatic:true});
  page.manual.forEach((r,index)=>buttons.push({rect:r,automatic:false,index}));
  for(const item of buttons) {
    const {rect:r,automatic,index}=item;
    const button=document.createElement('button');
    button.type='button';
    button.className='pdf-remove-rect';
    button.textContent='×';
    button.title=t(automatic ? 'pdf.removeAuto' : 'pdf.removeManual');
    button.setAttribute('aria-label',t('pdf.removeLabel', { action: button.title, page: pdfState.index+1 }));
    const x=(r.x+r.w)*pdfState.previewScale-18;
    const y=r.y*pdfState.previewScale+2;
    button.style.left=Math.max(0,Math.min(elPdf.overlay.width-22,x))+'px';
    button.style.top=Math.max(0,Math.min(elPdf.overlay.height-22,y))+'px';
    button.addEventListener('pointerdown',e=>e.stopPropagation());
    button.addEventListener('click',event=>{
      event.stopPropagation();
      if(pdfState.busy)return;
      if(automatic) page.dismissedAuto.add(autoRectKey(r));
      else page.manual.splice(index,1);
      invalidateReview();
      drawOverlay();updatePDFMeta();
    });
    layer.appendChild(button);
  }
}
function drawRect(ctx,r,color,scale) {
  ctx.fillStyle=color;
  ctx.fillRect(r.x*scale,r.y*scale,r.w*scale,r.h*scale);
  ctx.strokeStyle='rgba(241,247,241,.9)';ctx.lineWidth=1;
  ctx.strokeRect(r.x*scale,r.y*scale,r.w*scale,r.h*scale);
}
function pdfCursor(event) {
  const b=elPdf.overlay.getBoundingClientRect();
  const scaleX=elPdf.overlay.width/b.width, scaleY=elPdf.overlay.height/b.height;
  return {x:((event.clientX-b.left)*scaleX)/pdfState.previewScale,y:((event.clientY-b.top)*scaleY)/pdfState.previewScale};
}
elPdf.overlay.addEventListener('pointerdown',event=>{
  if(pdfState.busy || !pdfState.document) return;
  event.preventDefault();
  const point=pdfCursor(event);
  pdfState.dragging={x:point.x,y:point.y,w:0,h:0};
  elPdf.overlay.setPointerCapture(event.pointerId);
});
elPdf.overlay.addEventListener('pointermove',event=>{
  if(!pdfState.dragging)return;
  const point=pdfCursor(event);
  pdfState.dragging.w=point.x-pdfState.dragging.x;
  pdfState.dragging.h=point.y-pdfState.dragging.y;
  drawOverlay();
});
function finishRect(event){
  if(!pdfState.dragging)return;
  const page=pdfState.pages[pdfState.index];
  const box=normalizeRect(pdfState.dragging);
  pdfState.dragging=null;
  if(box.w>=3 && box.h>=3) {page.manual.push(boundRect(box,page.width,page.height));invalidateReview();}
  drawOverlay();updatePDFMeta();
}
elPdf.overlay.addEventListener('pointerup',finishRect);
elPdf.overlay.addEventListener('pointercancel',()=>{pdfState.dragging=null;drawOverlay();});
elPdf.undo.addEventListener('click',()=>{pdfState.pages[pdfState.index].manual.pop();invalidateReview();drawOverlay();updatePDFMeta();});
elPdf.clear.addEventListener('click',()=>{for(const p of pdfState.pages)p.manual=[];invalidateReview();drawOverlay();updatePDFMeta();});
elPdf['restore-auto'].addEventListener('click',()=>{for(const p of pdfState.pages)p.dismissedAuto.clear();invalidateReview();drawOverlay();updatePDFMeta();});
for(const el of [elPdf.reviewed, elPdf.raster]) el.addEventListener('change',updatePDFMeta);

async function generatePDF() {
  if(!pdfState.document || pdfState.busy || !totalBoxes() || pdfState.pages.some(p=>!p.viewed) || !elPdf.reviewed.checked || !elPdf.raster.checked)return;
  if(!window.confirm(t('pdf.confirm')))return;
  setBusy(true);
  const pages=[];
  try {
    for(let i=0;i<pdfState.pages.length;i++) {
      const p=pdfState.pages[i];
      pdfMessage('pdf.generating', { page: i+1, total: pdfState.pages.length });
      const page=await pdfState.document.getPage(i+1);
      const s=Math.min(2, 2800/p.width, 3500/p.height);
      const scale=Math.max(.1,s);
      const viewport=page.getViewport({scale});
      const canvas=document.createElement('canvas');
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      const context=canvas.getContext('2d',{alpha:false});
      context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
      await page.render({canvas,viewport}).promise;
      // Paint opaque black directly into rendered pixels (NOT a removable PDF annotation).
      context.fillStyle='#000';
      for(const r of [...visibleAuto(p),...p.manual]) context.fillRect(Math.max(0,r.x*scale),Math.max(0,r.y*scale),Math.min(canvas.width-r.x*scale,r.w*scale),Math.min(canvas.height-r.y*scale,r.h*scale));
      pages.push({jpeg:dataUrlToJpeg(canvas.toDataURL('image/jpeg',.94)),pixelWidth:canvas.width,pixelHeight:canvas.height,width:p.width,height:p.height});
      canvas.width=0;canvas.height=0;
    }
    const result=buildRasterPDF(pages);
    const blob=new Blob([result],{type:'application/pdf'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=t('file.pdfName');
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    pdfMessage('pdf.generated');
  } catch(e) {
    console.error('PDF export:',e);
    pdfMessage('pdf.exportError', { error: e }, true);
  } finally {setBusy(false);}
}
elPdf.export.addEventListener('click',generatePDF);

i18n.subscribe(() => {
  renderPDFMessage();
  updatePDFMeta();
  const page = pdfState.pages[pdfState.index];
  if (page) renderRemoveButtons(page);
});
renderPDFMessage();
