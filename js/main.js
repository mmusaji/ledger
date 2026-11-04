/* Start-up: opens saved data, shows the first screen, and registers the service worker for updates and offline use. */
import { loadDemo } from './demo.js';
import { bindEvents } from './events.js';
import { checkInbox } from './ingest.js';
import { S } from './state.js';
import { applyTheme, go, render, statusLine, toast } from './ui.js';
import { idb, openVault } from './vault.js';

if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

async function start() {
  applyTheme();
  // Clean out settings left behind by earlier versions (Google sync no longer exists).
  try { ['config', 'lastParent', 'sources'].forEach(k => localStorage.removeItem('ledger.' + k)); } catch { }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => reg.update()).catch(() => { });
    // When a new version of the app has installed itself, reload once so you're running it.
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded && !S.loading) { reloaded = true; location.reload(); } });
  }
  if (new URLSearchParams(location.search).has('demo')) { try { S.meta = await idb.get('meta') || null; } catch { } return loadDemo(); }
  try {
    S.meta = await idb.get('meta') || null;
    if (S.meta && S.meta.mode === 'device') await openVault(S.meta.key);
    else if (S.meta && S.meta.mode === 'pin') S.locked = true;
  } catch (e) { toast('Could not open the saved data: ' + e.message); }
  statusLine(); render();
  if (new URLSearchParams(location.search).has('shared')) { history.replaceState(null, '', location.pathname); if (!S.locked) go('data'); }
  checkInbox();
}

bindEvents();
start();
