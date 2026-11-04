/* Adding statements: the phone's file chooser and files sent with Share. Each PDF is read in memory, then discarded. */
import { P, RD } from './deps.js';
import { checkNewAccounts } from './accounts.js';
import { rebuild } from './model.js';
import { S } from './state.js';
import { render, status, statusLine, toast } from './ui.js';
import { $ } from './util.js';
import { PARSER_VERSION, ensureKey, saveVault } from './vault.js';

/** Read PDFs chosen with the phone's own file chooser (any folder, or Google Drive, with "Select all").
 *  Each file is identified by a fingerprint of its contents, so choosing a whole folder again
 *  only reads the statements that are new. Nothing is uploaded anywhere. */
async function addLocalFiles(list) {
  const fileList = [...list].filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (!fileList.length) return toast('No PDFs chosen.');
  if (S.demo && S.meta) return toast('This is the sample-data demo, so your own statements are not touched. Open the app without ?demo to add statements.');
  if (S.loading) return;
  S.loading = true; S.progress = 0; render();
  let added = 0, known = 0, skippedIgnored = 0; const notes = [];
  try {
    await ensureKey();
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      status(`Reading ${i + 1}/${fileList.length}`); S.progress = (i + 1) / fileList.length;
      const bar = $('#progress div'); if (bar) bar.style.width = (S.progress * 100) + '%';
      try {
        let bytes = await f.arrayBuffer();
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        const id = 'local:' + [...digest.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
        if (S.ignored.includes(id)) { skippedIgnored++; continue; }
        if (S.files[id] && S.files[id].v === PARSER_VERSION) { known++; continue; }
        const entry = { name: f.name, md5: '', modified: '', v: PARSER_VERSION, src: 'local' };
        const pages = await P.extractPages(window.pdfjsLib, bytes);
        bytes = null; // the PDF itself is dropped as soon as it has been read
        const r = RD.readStatement(pages, f.name);
        if (r.period && r.type !== 'unsupported' && r.type !== 'unreadable') entry.result = r;
        else entry.skipped = (r.problems || [])[0] || 'Not a statement this app reads';
        S.files[id] = entry; added++;
        if (added % 5 === 0) await saveVault();
      } catch (e) { notes.push({ name: f.name, why: 'Could not read: ' + e.message }); }
    }
    S.lastSync = new Date().toISOString(); S.demo = false;
    await saveVault(); rebuild(notes);
    toast(`${added} new file${added === 1 ? '' : 's'} read` + (known ? `, ${known} already in the app` : '') + (skippedIgnored ? `, ${skippedIgnored} removed earlier and left out` : ''));
  } catch (e) { toast(e.message); }
  finally { S.loading = false; statusLine(); render(); await checkNewAccounts(); }
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
    files.push(new File([await r.blob()], name, { type: 'application/pdf' }));
  }
  try { await addLocalFiles(files); }
  finally { for (const k of await c.keys()) await c.delete(k); }
}

export function chooseLocalFiles() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.multiple = true; inp.accept = 'application/pdf,.pdf';
  inp.onchange = () => addLocalFiles(inp.files);
  inp.click();
}
