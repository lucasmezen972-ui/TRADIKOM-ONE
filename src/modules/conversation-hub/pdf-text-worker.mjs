import { parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// Isolated CPU/heap and strict byte/page/time caps; no rendering, links or document actions.
let stage = 'module';
try {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  stage = 'assets';
  // Deployment tracers can omit the package manifest while retaining executable modules.
  // Resolve the same entry point we actually import, then locate its sibling assets.
  const assets = fileURLToPath(new URL('../../', import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs')));
  stage = 'load';
  const task = getDocument({ standardFontDataUrl: path.join(assets, 'standard_fonts') + '/',
    cMapUrl: path.join(assets, 'cmaps') + '/', cMapPacked: true, wasmUrl: path.join(assets, 'wasm') + '/', data: new Uint8Array(workerData), isEvalSupported: false,
    useWorkerFetch: false, disableAutoFetch: true, stopAtErrors: true, maxImageSize: 0 });
  const document = await task.promise;
  stage = 'pages';
  try {
    if (document.numPages > 20) throw new Error('document_page_limit');
    let text = '';
    for (let page = 1; page <= document.numPages && text.length < 16000; page++) {
      const content = await (await document.getPage(page)).getTextContent();
      text += content.items.map(item => 'str' in item ? item.str : '').join(' ') + '\n';
    }
    if (!text.trim()) throw new Error('document_no_text');
    parentPort.postMessage({ ok: true, text: text.slice(0, 16000) });
  } finally { await document.destroy(); }
} catch { parentPort.postMessage({ ok: false, stage }); }
