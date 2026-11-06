/* Adding statements: the phone's file chooser and files sent with Share. PDFs and CSVs are told apart by what is inside
 * them, read in memory, then discarded. A file that cannot be read is not kept; the result sheet says why. */
import { CSVR, P, RD } from './deps.js';
import { checkNewAccounts } from './accounts.js';
import { importSheet } from './importview.js';
import { rebuild } from './model.js';
import { readOne, summarise } from './pipeline.js';
import { S } from './state.js';
import { render, status, statusLine, toast } from './ui.js';
import { $ } from './util.js';
import { PARSER_VERSION, ensureKey, saveVault } from './vault.js';

const WANTED = f => /\.(pdf|csv|txt)$/i.test(f.name) || /^(application\/pdf|text\/csv|application\/vnd\.ms-excel)$/.test(f.type);

/** Read statements chosen with the phone's own file chooser (any folder, or Google Drive, with "Select all").
 *  Each file is identified by a fingerprint of its contents, so choosing a whole folder again
 *  only reads the statements that are new. Nothing is uploaded anywhere. */
async function addLocalFiles(list) {
  const fileList = [...list].filter(WANTED);
  if (!fileList.length) return toast('No PDF or CSV statements chosen.');
  if (S.demo && S.meta) return toast('This is the sample-data demo, so your own statements are not touched. Open the app without ?demo to add statements.');
  if (S.loading) return;
  S.loading = true; S.progress = 0; render();
  const outcomes = [];
  try {
    await ensureKey();
    const ctx = { files: S.files, ignored: S.ignored, version: PARSER_VERSION, CSVR, RD, extractPages: bytes => P.extractPages(window.pdfjsLib, bytes) };
    for (let i = 0; i < fileList.length; i++) {
      status(`Reading ${i + 1}/${fileList.length}`); S.progress = (i + 1) / fileList.length;
      const bar = $('#progress div'); if (bar) bar.style.width = (S.progress * 100) + '%';
      const o = await readOne(fileList[i], ctx); outcomes.push(o);
      if (o.status === 'added') { S.files[o.id] = o.entry; if (outcomes.filter(x => x.status === 'added').length % 5 === 0) await saveVault(); }
    }
    S.lastSync = new Date().toISOString(); S.demo = false;
    S.lastImport = summarise(outcomes);
    await saveVault(); rebuild();
  } catch (e) { toast(e.message); }
  finally {
    S.loading = false; statusLine(); render();
    if (S.lastImport && outcomes.length) {
      // the result is shown first; the "household or personal?" question for a new account waits until it is closed
      S.sheetLocked = false; $('#sheet-body').innerHTML = importSheet(S.lastImport);
      await new Promise(res => { const d = $('#sheet'); d.addEventListener('close', res, { once: true }); d.showModal(); });
    }
    await checkNewAccounts();
  }
}

/** Files sent with the phone's Share menu (for example from the Google Drive app) are parked briefly by the
 *  service worker, read here, then deleted straight away. */
export async function checkInbox() {
  if (S.locked || S.loading || !('caches' in window)) return;
  let c; try { c = await caches.open('ledger-inbox'); } catch { return; }
  const keys = await c.keys(); if (!keys.length) return;
  const files = [];
  for (const k of keys) {
    const r = await c.match(k); if (!r) continue;
    const name = decodeURIComponent(r.headers.get('x-name') || 'shared.pdf');
    files.push(new File([await r.blob()], name, { type: r.headers.get('x-type') || '' }));
  }
  try { await addLocalFiles(files); }
  finally { for (const k of await c.keys()) await c.delete(k); }
}

export function chooseLocalFiles() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.multiple = true; inp.accept = 'application/pdf,.pdf,text/csv,.csv';
  inp.onchange = () => addLocalFiles(inp.files);
  inp.click();
}
