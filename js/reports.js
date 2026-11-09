/* Reports screen: search and filter transactions, with totals. */
import { scopeBar } from './charts.js';
import { CATEGORIES } from './deps.js';
import { scopeTxns } from './model.js';
import { cycleLabel } from './period.js';
import { S } from './state.js';
import { figuresNotice } from './notices.js';
import { emptyState } from './ui.js';
import { $, esc, gbp, niceShort, sum } from './util.js';

const KINDS = ['Card purchase', 'Direct debit', 'Standing order', 'Card payment', 'Payment out', 'Payment in', 'Bank credit', 'Transfer', 'Cash', 'Card fee/credit', 'Bank charge/credit', 'Other'];

function applyFilter(f) {
  const terms = f.q.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const min = f.min === '' ? null : Math.round(parseFloat(f.min) * 100);
  const max = f.max === '' ? null : Math.round(parseFloat(f.max) * 100);
  return scopeTxns().filter(t => {
    if (t.group === 'internal') return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (f.dir === 'out' && t.amount >= 0) return false;
    if (f.dir === 'in' && t.amount <= 0) return false;
    if (f.cats.length && !f.cats.includes(t.category)) return false;
    if (f.kinds.length && !f.kinds.includes(t.kind)) return false;
    if (f.accounts && f.accounts.length && !f.accounts.includes(t.account)) return false;
    const a = Math.abs(t.amount);
    if (min !== null && a < min) return false;
    if (max !== null && a > max) return false;
    if (terms.length) {
      const hay = (t.desc + ' ' + t.payee + ' ' + t.category + ' ' + (t.detail || '')).toLowerCase();
      const hits = terms.map(x => hay.includes(x));
      if (f.match === 'all' ? !hits.every(Boolean) : !hits.some(Boolean)) return false;
    }
    return true;
  });
}

export function renderReports() {
  const el = $('#view-reports');
  if (!scopeTxns().length) return emptyState(el);
  const f = S.filter; if (!f.accounts) f.accounts = [];
  const res = applyFilter(f);
  const out = -sum(res.filter(t => t.amount < 0)), inn = sum(res.filter(t => t.amount > 0));
  const byMonth = {}; res.forEach(t => { byMonth[t.cycle] = (byMonth[t.cycle] || 0) + t.amount; });
  const byPayee = {}; res.forEach(t => { byPayee[t.payee] = byPayee[t.payee] || { v: 0, n: 0 }; byPayee[t.payee].v += t.amount; byPayee[t.payee].n++; });
  const payees = Object.entries(byPayee).sort((a, b) => Math.abs(b[1].v) - Math.abs(a[1].v)).slice(0, 12);
  const byAcc = {}; res.forEach(t => { byAcc[t.account] = byAcc[t.account] || { v: 0, n: 0 }; byAcc[t.account].v += t.amount; byAcc[t.account].n++; });
  const accounts = [...new Set(scopeTxns().filter(t => t.group !== 'internal').map(t => t.account))].sort((a, b) => (a === 'Joint account') - (b === 'Joint account') || a.localeCompare(b));
  const quick = [['latest', 'Pay month'], ['3', '3 months'], ['6', '6 months'], ['tax', 'Tax year'], ['all', 'All dates']];
  const activeCount = (f.cats.length ? 1 : 0) + (f.kinds.length ? 1 : 0) + (f.min || f.max ? 1 : 0);

  el.innerHTML = `
    ${scopeBar()}${figuresNotice()}
    ${S.presets.length ? `<div class="chips">${S.presets.map((p, i) => `<button class="chip" data-act="preset" data-v="${i}">${esc(p.name)}</button>`).join('')}</div>` : ''}
    <div class="card stack">
      <label class="field">Search (separate several with commas)
        <input id="f-q" type="search" placeholder="e.g. amazon, deliveroo" value="${esc(f.q)}" autocomplete="off"></label>
      <div class="row wrapgap"><div class="seg" id="f-match">${['any', 'all'].map(m => `<button data-v="${m}" class="${f.match === m ? 'on' : ''}">${m === 'any' ? 'Any word' : 'All words'}</button>`).join('')}</div>
        <div class="seg" id="f-dir">${[['out', 'Out'], ['in', 'In'], ['both', 'Both']].map(([k, l]) => `<button data-v="${k}" class="${f.dir === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div><div class="muted small">Account / card</div><div class="chips wrap" style="margin-top:6px">${accounts.map(a => `<button class="chip ${f.accounts.includes(a) ? 'on' : ''}" data-act="facc" data-v="${esc(a)}">${esc(a)}</button>`).join('')}</div></div>
      <div class="grid2">
        <label class="field">From<input id="f-from" type="date" value="${f.from}"></label>
        <label class="field">To<input id="f-to" type="date" value="${f.to}"></label>
      </div>
      <div class="chips">${quick.map(([k, l]) => `<button class="chip" data-act="quick" data-v="${k}">${l}</button>`).join('')}</div>
      <details class="filters" ${activeCount ? 'open' : ''}><summary>More filters${activeCount ? ` (${activeCount} on)` : ''} ▾</summary>
        <div class="stack" style="margin-top:10px">
          <div><div class="muted small">Categories</div><div class="chips wrap" style="margin-top:6px">${CATEGORIES.map(c => `<button class="chip ${f.cats.includes(c.name) ? 'on' : ''}" data-act="fcat" data-v="${esc(c.name)}">${esc(c.name)}</button>`).join('')}</div></div>
          <div><div class="muted small">Payment type</div><div class="chips wrap" style="margin-top:6px">${KINDS.map(k => `<button class="chip ${f.kinds.includes(k) ? 'on' : ''}" data-act="fkind" data-v="${esc(k)}">${esc(k)}</button>`).join('')}</div></div>
          <div class="grid2"><label class="field">Min £<input id="f-min" inputmode="decimal" value="${esc(f.min)}"></label><label class="field">Max £<input id="f-max" inputmode="decimal" value="${esc(f.max)}"></label></div>
        </div></details>
      <div class="row"><button class="btn ghost" data-act="reset">Clear filters</button><button class="btn ghost" data-act="save-preset">Save this report</button></div>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="label">Total out</div><div class="value out">${gbp(out)}</div></div>
      <div class="kpi"><div class="label">Total in</div><div class="value in">${gbp(inn)}</div></div>
      <div class="kpi"><div class="label">Transactions</div><div class="value">${res.length}</div><div class="sub">${res.length ? 'avg ' + gbp((inn - out) / res.length) : ''}</div></div>
    </div>

    ${res.length ? `
    <h2>By account / card</h2>
    <div class="card"><table class="mini"><tr><th>Account</th><th class="r">#</th><th class="r">Total</th></tr>${Object.entries(byAcc).sort((a, b) => a[1].v - b[1].v).map(([a, o]) => `<tr><td>${esc(a)}</td><td class="r">${o.n}</td><td class="r num">${gbp(o.v)}</td></tr>`).join('')}</table></div>
    <h2>By pay month</h2>
    <div class="card"><table class="mini"><tr><th>Pay month</th><th class="r">Net</th></tr>${Object.entries(byMonth).sort().map(([k, v]) => `<tr><td>${cycleLabel(k)}</td><td class="r num ${v < 0 ? 'out' : 'in'}">${gbp(v)}</td></tr>`).join('')}</table></div>
    <h2>By payee</h2>
    <div class="card"><table class="mini"><tr><th>Payee</th><th class="r">#</th><th class="r">Total</th></tr>${payees.map(([p, o]) => `<tr><td>${esc(p)}</td><td class="r">${o.n}</td><td class="r num">${gbp(o.v)}</td></tr>`).join('')}</table></div>
    <h2>Transactions</h2>
    <div class="card"><ul class="list">${res.slice().reverse().slice(0, S.showN).map(txnRow).join('')}</ul>
      ${res.length > S.showN ? `<button class="btn ghost" style="width:100%;margin-top:8px" data-act="more">Show more (${res.length - S.showN})</button>` : ''}</div>` : `<div class="card muted">Nothing matches these filters.</div>`}`;

  const upd = (id, k, ev = 'input') => { const i = $(id); if (i) i.addEventListener(ev, () => { f[k] = i.value; S.showN = 100; rerenderKeepFocus(id); }); };
  upd('#f-q', 'q'); upd('#f-from', 'from', 'change'); upd('#f-to', 'to', 'change'); upd('#f-min', 'min'); upd('#f-max', 'max');
  $('#f-match').addEventListener('click', e => { const v = e.target.dataset.v; if (v) { f.match = v; renderReports(); } });
  $('#f-dir').addEventListener('click', e => { const v = e.target.dataset.v; if (v) { f.dir = v; renderReports(); } });
}

let rrTimer;

function rerenderKeepFocus(id) {
  clearTimeout(rrTimer);
  rrTimer = setTimeout(() => {
    const a = document.activeElement; const pos = a && a.selectionStart;
    const open = document.querySelector('details.filters')?.open;
    renderReports();
    if (open) document.querySelector('details.filters').open = true;
    const n = $(id); if (n) { n.focus(); try { if (pos != null) n.setSelectionRange(pos, pos); } catch { } }
  }, 250);
}

function txnRow(t) {
  const acc = t.account === 'Joint account' ? 'Bank' : t.account;
  return `<li class="tap" data-act="txn" data-v="${t.key}"><div class="who"><b>${esc(t.payee)}</b><span>${niceShort(t.date)} ${t.date.slice(0, 4)} · ${esc(acc)} · <span class="pill">${esc(t.category)}</span></span></div><span class="num ${t.amount < 0 ? 'out' : 'in'}">${gbp(t.amount, true)}</span></li>`;
}
