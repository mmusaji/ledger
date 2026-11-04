/* Click handling and the auto-lock timer. Everything on the page is wired up from here. */
import { loadDemo } from './demo.js';
import { GROUP_OF } from './deps.js';
import { renderHome } from './home.js';
import { checkInbox, chooseLocalFiles } from './ingest.js';
import { rangeFor, rebuild, recategorise } from './model.js';
import { renderPay } from './pay.js';
import { renderReports } from './reports.js';
import { renderSettings } from './settings.js';
import { S, blankFilter } from './state.js';
import { renderData } from './statements.js';
import { openTxn, saveTxn } from './txn.js';
import { go, render, statusLine, toast } from './ui.js';
import { $, store } from './util.js';
import { askNewPin, idb, keyFromPin, lock, openVault, saveVault, setPin } from './vault.js';

export function bindEvents() {
  // ---------- events ----------
  document.addEventListener('click', async e => {
    const tab = e.target.closest('[data-view]'); if (tab) { if (!S.locked) go(tab.dataset.view); return; }
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'add-rule') return;
    const v = a.dataset.v; const f = S.filter;
    try {
      switch (a.dataset.act) {
        case 'go-settings': return go('settings');
        case 'demo': return loadDemo();
        case 'add-local': return chooseLocalFiles();
        case 'ignore': {
          if (!confirm('Stop using this file in the app? (The PDF itself is untouched wherever you keep it.)')) return;
          S.ignored = [...new Set(S.ignored.concat(v))]; store.set('ignored', S.ignored);
          delete S.files[v]; await saveVault(); rebuild(); return render();
        }
        case 'unignore': S.ignored = []; store.set('ignored', S.ignored); renderData(); return toast('Add the PDFs again to read them.');
        case 'unlock': {
          const pin = $('#pin').value; if (!pin) return;
          a.disabled = true;
          try { await openVault(await keyFromPin(pin, S.meta.salt)); } catch { a.disabled = false; $('#pin').value = ''; return toast('Wrong passcode'); }
          statusLine(); go('home'); return checkInbox();
        }
        case 'lock': return lock();
        case 'change-pin': { const pin = await askNewPin(S.meta && S.meta.mode === 'pin'); if (pin === undefined) return; if (pin === null && S.meta && S.meta.mode !== 'pin') return; await setPin(pin); renderSettings(); return toast(pin ? 'Passcode set' : 'Saved without a passcode'); }
        case 'remove-pin': if (!confirm('Remove the passcode? Anyone who can open this app on your phone will see your saved statements.')) return; await setPin(null); renderSettings(); return toast('Passcode removed');
        case 'erase-data':
          if (!confirm('Erase the saved statements from this phone? Your settings and rules are kept. You add the PDFs again to read them.')) return;
          await idb.clear(); S.files = {}; S.key = null; S.meta = null; S.locked = false; S.lastSync = null; rebuild(); statusLine(); return go('home');
        case 'period': S.period = v; return renderHome();
        case 'toggle-oneoffs': S.hideOneOffs = !S.hideOneOffs; store.set('hideOneOffs', S.hideOneOffs); return renderHome();
        case 'cat': { const r = rangeFor(S.period); S.filter = Object.assign(blankFilter(), { cats: [v], from: r.from, to: r.to, dir: 'both' }); return go('reports'); }
        case 'payee': { const r = rangeFor(S.period); S.filter = Object.assign(blankFilter(), { q: v, from: r.from, to: r.to }); return go('reports'); }
        case 'payslip': S.payIdx = +v; return renderPay();
        case 'txn': return openTxn(v);
        case 'sheet-close': return $('#sheet').close();
        case 'sheet-save': return saveTxn(v);
        case 'quick': { const r = rangeFor(v); if (r) { f.from = r.from; f.to = r.to; } return renderReports(); }
        case 'facc': f.accounts = f.accounts.includes(v) ? f.accounts.filter(x => x !== v) : f.accounts.concat(v); return renderReports();
        case 'fcat': f.cats = f.cats.includes(v) ? f.cats.filter(x => x !== v) : f.cats.concat(v); renderReports(); document.querySelector('details.filters').open = true; return;
        case 'fkind': f.kinds = f.kinds.includes(v) ? f.kinds.filter(x => x !== v) : f.kinds.concat(v); renderReports(); document.querySelector('details.filters').open = true; return;
        case 'reset': S.filter = blankFilter(); return renderReports();
        case 'more': S.showN += 200; return renderReports();
        case 'save-preset': { const name = prompt('Name this report', f.q || (f.cats[0] || 'My report')); if (!name) return; S.presets.push({ name, filter: JSON.parse(JSON.stringify(f)) }); store.set('presets', S.presets); renderReports(); return toast('Saved. It appears at the top of Reports.'); }
        case 'preset': S.filter = Object.assign(blankFilter(), JSON.parse(JSON.stringify(S.presets[+v].filter))); return renderReports();
        case 'del-preset': S.presets.splice(+v, 1); store.set('presets', S.presets); return renderSettings();
        case 'del-rule': S.rules.splice(+v, 1); store.set('rules', S.rules); recategorise(); return renderSettings();
        case 'import-rules': {
          let arr; try { arr = JSON.parse($('#r-json').value); } catch { return toast('That is not valid JSON.'); }
          if (!Array.isArray(arr)) arr = arr.rules;
          const ok = (arr || []).filter(r => r && typeof r.text === 'string' && GROUP_OF[r.category]).map(r => ({ text: r.text, category: r.category, dir: r.dir === 'in' || r.dir === 'out' ? r.dir : undefined }));
          if (!ok.length) return toast('No valid rules found.');
          const seen = new Set(S.rules.map(r => r.text.toLowerCase() + '|' + r.dir));
          S.rules = S.rules.concat(ok.filter(r => !seen.has(r.text.toLowerCase() + '|' + r.dir)));
          store.set('rules', S.rules); recategorise(); renderSettings(); return toast(`Imported ${ok.length} rules`);
        }
        case 'copy-rules': await navigator.clipboard.writeText(JSON.stringify(S.rules, null, 1)); return toast('Rules copied');
        case 'forget':
          if (!confirm('Remove all saved statements, settings, sources, rules and saved reports from this phone?')) return;
          store.clear(); await idb.clear(); location.reload(); return;
      }
    } catch (err) { toast(err.message || String(err)); }
  });
  $('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet' && !S.sheetLocked) $('#sheet').close(); });
  $('#sheet').addEventListener('cancel', e => { if (S.sheetLocked) e.preventDefault(); });
  // Auto-lock after 5 minutes in the background (passcode mode only).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) S.hiddenAt = Date.now();
    else if (S.hiddenAt && Date.now() - S.hiddenAt > 5 * 60e3 && !S.loading) lock();
  });
}
