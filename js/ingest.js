/* Adding statements: the phone's file chooser and files sent with Share. PDFs and CSVs are told apart by what is inside
 * them, read in memory, then discarded. Everything is staged first and saved in one go at the end: if you cancel, or
 * something goes wrong, nothing from that import is kept. A file that cannot be read is never kept. */
import { CSVR, P, RD, SMART } from './deps.js';
import { askAccount } from './accountsheet.js';
import { applyChoice, bookOf } from './book.js';
import { checkNewAccounts } from './accounts.js';
import { importSheet } from './importview.js';
import { rebuild } from './model.js';
import { readOne, summarise } from './pipeline.js';
import { S } from './state.js';
import { render, status, statusLine, toast } from './ui.js';
import { $, store } from './util.js';
import { PARSER_VERSION, ensureKey, saveVault } from './vault.js';

const WANTED = f => /\.(pdf|csv|txt)$/i.test(f.name) || /^(application\/pdf|text\/csv|text\/comma-separated-values|application\/vnd\.ms-excel)$/.test(f.type);

/** Read statements chosen with the phone's own file chooser (any folder, or Google Drive, with "Select all").
 *  Each file is identified by a fingerprint of its contents, so choosing a whole folder again
 *  only reads the statements that are new. Nothing is uploaded anywhere. */
let importing = false; // one import at a time, including while its questions are open (S.loading is off then)

async function addLocalFiles(list) {
  const fileList = [...list].filter(WANTED);
  if (!fileList.length) return toast('No PDF or CSV statements chosen.');
  if (S.demo && S.meta) return toast('This is the sample-data demo, so your own statements are not touched. Open the app without ?demo to add statements.');
  if (S.loading || importing) return toast('An import is already open. Finish it first.');
  importing = true; S.loading = true; S.progress = 0; render();
  const outcomes = [], staged = {}; let cancelled = false, sum = null;
  try {
    await ensureKey();
    const ctx = { files: Object.assign({}, S.files), ignored: S.ignored, version: PARSER_VERSION, CSVR, RD, SMART: store.get('smartPdf', true) ? SMART : null, extractPages: bytes => P.extractPages(window.pdfjsLib, bytes) };
    for (let i = 0; i < fileList.length; i++) {
      status(`Reading ${i + 1}/${fileList.length}`); S.progress = (i + 1) / fileList.length;
      const bar = $('#progress div'); if (bar) bar.style.width = (S.progress * 100) + '%';
      const o = await readOne(fileList[i], ctx); outcomes.push(o);
      if (o.status === 'added') { staged[o.id] = o.entry; ctx.files[o.id] = o.entry; }
    }
    // CSV files do not say which account they are from. A layout seen before is attached silently; a new one is asked about once.
    const work = JSON.parse(JSON.stringify(bookOf(S.book))); const created = [], newLayouts = [], roles = {};
    const csv = outcomes.filter(o => o.status === 'added' && o.entry.result.type === 'csv'), bySig = {};
    csv.forEach(o => { const k = o.entry.result.sig || o.id; (bySig[k] = bySig[k] || []).push(o); }); // a file with no layout signature is always asked about
    const nameOf = id => (work.accounts.find(a => a.id === id) || {}).name;
    for (const [sig, group] of Object.entries(bySig)) {
      const known = group[0].entry.result.sig ? work.layouts[sig] : null;
      if (known && nameOf(known)) { group.forEach(o => { work.assign[o.id] = known; o.attached = nameOf(known); o.remembered = true; }); continue; }
      S.loading = false; render();
      const r0 = group[0].entry.result;
      const ans = await askAccount({ files: group.map(o => ({ name: o.name, rows: o.rows, period: o.period })), kind: r0.accountType, why: r0.accountTypeWhy, book: work });
      if (ans === null) { cancelled = true; break; }
      if (ans === 'skip') continue;
      const { accountId, created: c } = applyChoice(work, ans);
      if (c) { created.push(c.id); if (c.kind === 'current' && !c.link) roles[c.id] = c.role; }
      if (group[0].entry.result.sig) { work.layouts[sig] = accountId; newLayouts.push(sig); }
      group.forEach(o => { work.assign[o.id] = accountId; o.attached = nameOf(accountId); });
    }
    if (cancelled) { toast('Import cancelled. Nothing was saved.'); outcomes.length = 0; return; }
    // commit everything at once
    const before = new Set(Object.keys(S.files));
    Object.assign(S.files, staged); S.book = work;
    if (Object.keys(roles).length) { Object.entries(roles).forEach(([id, role]) => { S.accounts[id] = { role }; }); if (!S.demo) store.set('accounts', S.accounts); }
    S.lastSync = new Date().toISOString(); S.demo = false;
    rebuild();
    outcomes.forEach(o => { if (o.status === 'added' && S.overlap && S.overlap[o.id]) o.overlap = S.overlap[o.id]; });
    // Undo takes back only files that were new; one read again by a newer reader version would be lost entirely
    const fresh = Object.keys(staged).filter(id => !before.has(id));
    sum = Object.assign(summarise(outcomes), { undo: fresh.length || created.length ? { files: fresh, accounts: created, layouts: newLayouts } : null });
    // a batch that changed nothing (everything already known) does not replace the last real import, so its Undo stays
    if (sum.added.length || sum.failed.length) S.lastImport = sum;
    await saveVault();
  } catch (e) { toast('Nothing was saved: ' + e.message); outcomes.length = 0; }
  finally {
    importing = false; S.loading = false; statusLine(); render();
    if (sum && outcomes.length) {
      // the result is shown first; the "household or personal?" question for a new PDF account waits until it is closed
      S.sheetLocked = false; $('#sheet-body').innerHTML = importSheet(sum);
      await new Promise(res => { const d = $('#sheet'); d.addEventListener('close', res, { once: true }); d.showModal(); });
    }
    await checkNewAccounts();
  }
}

/** Take back the last import: its files, the accounts it created and the layouts it taught. Nothing else changes. */
export async function undoLastImport() {
  const u = S.lastImport && S.lastImport.undo; if (!u) return;
  u.files.forEach(id => { delete S.files[id]; delete S.book.assign[id]; });
  S.book.accounts = S.book.accounts.filter(a => !u.accounts.includes(a.id));
  u.layouts.forEach(sig => { delete S.book.layouts[sig]; });
  u.accounts.forEach(id => { delete S.accounts[id]; });
  if (!S.demo) store.set('accounts', S.accounts);
  S.lastImport = null; await saveVault(); rebuild(); render(); toast('Last import undone');
}

/** Files sent with the phone's Share menu (for example from the Google Drive app) are parked briefly by the
 *  service worker, read here, then deleted straight away. */
export async function checkInbox() {
  if (S.locked || S.loading || importing || !('caches' in window)) return;
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
