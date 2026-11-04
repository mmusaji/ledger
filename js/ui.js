/* Screen plumbing: status line, toasts, switching screens, the empty and locked screens, and the theme. */
import { renderHome } from './home.js';
import { renderPay } from './pay.js';
import { renderReports } from './reports.js';
import { renderSavings } from './savings.js';
import { renderSettings } from './settings.js';
import { S } from './state.js';
import { renderData } from './statements.js';
import { $, store } from './util.js';

export function statusLine() {
  if (S.demo) return status('Sample data (invented)');
  if (S.locked) return status('Locked');
  if (!S.statements.length) return status('');
  const d = S.lastSync ? new Date(S.lastSync).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never';
  status(`updated ${d}`);
}

export function status(t) { $('#status').textContent = t; }

let toastTimer;

export function toast(msg) {
  let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}

export function go(view) {
  S.view = view;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + view; });
  render(); window.scrollTo(0, 0);
}

export function render() {
  document.body.classList.toggle('locked', S.locked);
  if (S.locked) { document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-home'; }); return renderLock(); }
  ({ home: renderHome, reports: renderReports, pay: renderPay, savings: renderSavings, data: renderData, settings: renderSettings })[S.view]();
}

export function emptyState(target, what) {
  target.innerHTML = `<div class="card empty">
    ${S.loading ? `<p><b>Reading your statements…</b></p><div class="progress" id="progress"><div style="width:${S.progress * 100}%"></div></div>` : `
    <p><b>${what || 'No statements yet'}</b></p>
    <p class="muted small">Tap <b>Add PDFs</b>, open your statements folder (any folder on your phone, or Google Drive) and choose <b>Select all</b>. Only statements the app hasn't seen before are read.</p>
    <button class="btn" data-act="add-local">Add PDFs</button>
    ${S.txns.length ? '' : `<div><button class="btn ghost" style="margin-top:10px" data-act="demo">Explore with sample data</button></div>`}`}
  </div>`;
}

function renderLock() {
  $('#view-home').innerHTML = `<div class="card empty stack">
    <p style="margin:0"><b>Locked</b></p>
    <p class="muted small" style="margin:0">Enter your passcode to open your saved statements.</p>
    <input id="pin" class="input" type="password" inputmode="numeric" autocomplete="current-password" aria-label="Passcode" style="text-align:center;letter-spacing:.3em">
    <button class="btn" data-act="unlock" style="width:100%">Unlock</button>
    <button class="btn ghost" data-act="erase-data" style="width:100%">Forgot it? Erase saved data</button></div>`;
  const i = $('#pin'); i.focus(); i.addEventListener('keydown', e => { if (e.key === 'Enter') $('[data-act=unlock]').click(); });
}

export function applyTheme() { const t = store.get('theme', 'auto'); if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t; }
