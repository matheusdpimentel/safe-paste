"""Optional browser integration smoke test for replacing PDFs (mocked PDF.js only).
Requires: pip install playwright; Chromium installed; no external network required.
"""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
MOCK_JS = r'''
window.__pdfDestroyed = window.__pdfDestroyed || [];
export const GlobalWorkerOptions = { workerSrc: '' };
export const Util = { transform(a,b) { return b; } };
export function getDocument({data}) {
  const source = new TextDecoder().decode(data);
  const id = source.split(/\r?\n/).at(-1);
  const worker = {
    promise: source.includes('CORRUPT') ? Promise.reject(Object.assign(new Error('Invalid PDF (synthetic test)'), {name:'InvalidPDFException'})) : Promise.resolve({
      numPages: 1,
      async getPage() { return {
        getViewport({scale}) {return {width: 595*scale,height: 842*scale,transform:[scale,0,0,scale,0,0]};},
        async getTextContent() {return {items:[{str:'CPF: 123.456.789-09',transform:[1,0,0,13,40,65],width:200,height:13,hasEOL:true}]};},
        render({canvas}) {const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,canvas.width,canvas.height);c.fillStyle='#222';c.fillText(id,20,30);return {promise:Promise.resolve()};}
      }; }
      // Intentionally NO PDFDocumentProxy.destroy() to reproduce the original regression.
    }),
    async destroy() {window.__pdfDestroyed.push(id);},
  };
  return worker;
}
'''

def run():
  with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **({'executable_path': os.environ['CHROME_BIN']} if os.environ.get('CHROME_BIN') else {}))
    page = browser.new_page(accept_downloads=True, locale="pt-BR")
    page.add_init_script('window.__pdfDestroyed = [];')
    page.route('https://cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200,content_type='text/javascript',body=MOCK_JS,headers={'Access-Control-Allow-Origin':'*'}))
    errors=[]
    page.on('pageerror', lambda exc: errors.append(str(exc)))
    page.set_content(ROOT.joinpath('index.html').read_text(encoding='utf-8'), wait_until='load')
    page.locator('#mode-pdf').click()
    def choose(name,content):
      page.locator('#pdf-file').set_input_files({'name':name,'mimeType':'application/pdf','buffer':b'%PDF-1.4\n'+content.encode()})
    choose('primeiro.pdf','PRIMEIRO')
    expect(page.locator('#pdf-name')).to_have_text('primeiro.pdf')
    expect(page.locator('#pdf-ready')).to_be_visible()
    assert page.locator('.pdf-remove-rect').count() >= 1, 'A redaction suggestion must be visible'
    with page.expect_file_chooser() as picker:
      page.locator('#pdf-restart').click()
    picker.value.set_files({'name':'segundo.pdf','mimeType':'application/pdf','buffer':b'%PDF-1.4\nSEGUNDO'})
    expect(page.locator('#pdf-name')).to_have_text('segundo.pdf')
    expect(page.locator('#pdf-page')).to_contain_text('1 de 1')
    assert 'PRIMEIRO' in page.evaluate('window.__pdfDestroyed'), 'The first PDF loading task was not released'
    page.locator('#pdf-reviewed').check()
    page.locator('#pdf-raster').check()
    choose('corrompido.pdf','CORRUPT')
    expect(page.locator('#pdf-message')).to_contain_text('inválido ou está corrompido')
    assert page.locator('#pdf-name').inner_text() == 'segundo.pdf', 'A failed replacement must preserve the previous PDF'
    assert page.locator('#pdf-ready').is_visible(), 'The previous PDF must remain visible'
    assert page.locator('#pdf-ready-message').is_visible(), 'The error must remain visible in the editor'
    expect(page.locator('#pdf-ready-message')).to_contain_text('inválido ou está corrompido')
    expect(page.locator('#pdf-reviewed')).to_be_checked()
    expect(page.locator('#pdf-raster')).to_be_checked()
    choose('segundo.pdf','SEGUNDO')
    expect(page.locator('#pdf-message')).to_contain_text('Prévia pronta')
    assert 'SEGUNDO' in page.evaluate('window.__pdfDestroyed'), 'The previous PDF loading task was not released'
    assert not errors, 'JavaScript errors: '+str(errors)
    print('PASS: successive replacements, resource cleanup, controlled failure, same filename, preview and redactions.')
    browser.close()

if __name__=='__main__':run()
