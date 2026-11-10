/* Documents screen (the Statements tab): everything that has been added, in and out: what is missing, card repayments. */
import { scopeBar } from './charts.js';
import { lastImportCard } from './importview.js';
import { MARK_TEXT } from './pipeline.js';
import { accIdOf, activeScope, isBankStmt, scopeStatements } from './model.js';
import { S } from './state.js';
import { $, MON, addDays, daysBetween, esc, gbp, isoOf, monthLabel, nice, niceShort, pad, store, today } from './util.js';

const MONEY = ['santander', 'amex', 'tesco', 'monzo'];
const TYPES = [['santander', 'Santander', 5], ['amex', 'Amex', 19], ['tesco', 'Tesco CC', 24], ['payslip', 'Payslips', 26]];

/** The statements that belong to the view: household = its accounts, cards, payslips, ISA and pension; a personal
 *  account = just that account. Statements for an account that has no role yet are not shown in either. */
function inScope() {
  const sc = activeScope(); const own = new Set(scopeStatements().map(s => s.id));
  return S.statements.filter(s => isBankStmt(s) ? own.has(s.id) : sc === 'household');
}

function coverage(list) {
  const end = today(); const months = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(end + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); months.push(isoOf(d).slice(0, 7)); }
  const types = activeScope() === 'household' ? TYPES.concat(list.some(s => s.type === 'monzo') ? [['monzo', 'Monzo', 4]] : []) : [[list[0] ? list[0].type : 'monzo', list[0] ? (list[0].institution || 'Account') : 'Account', 4]];
  const rows = types.map(([type, label, day]) => ({ type, label, cells: months.map(m => {
    // a statement of a current account can cover several months, so it counts for every month it reaches the middle of
    const st = list.filter(s => s.type === type && (type === 'monzo' ? s.period.start <= m + '-15' && s.period.end >= m + '-15' : s.period.end.slice(0, 7) === m));
    if (st.length) return st.every(s => s.ok) ? 'ok' : 'chk';
    const due = addDays(`${m}-${pad(Math.min(day, 28))}`, 4);
    return end < due ? 'due' : 'miss';
  }) }));
  const missing = [];
  rows.forEach(r => r.cells.forEach((c, i) => { if (c === 'miss') missing.push(`${r.label} ${monthLabel(months[i])}`); }));
  // gaps between consecutive bank statements
  const gaps = [];
  const perAcc = {}; list.filter(s => s.type === 'santander').forEach(s => { (perAcc[accIdOf(s)] = perAcc[accIdOf(s)] || []).push(s); });
  Object.values(perAcc).forEach(bank => {
    for (let i = 1; i < bank.length; i++) {
      if (daysBetween(bank[i - 1].period.end, bank[i].period.start) > 3) gaps.push(`${niceShort(addDays(bank[i - 1].period.end, 1))} – ${nice(addDays(bank[i].period.start, -1))}`);
      else if (bank[i - 1].closing !== undefined && bank[i].opening !== undefined && bank[i - 1].closing !== bank[i].opening) gaps.push(`balance doesn't carry over between ${niceShort(bank[i - 1].period.end)} and ${niceShort(bank[i].period.start)}`);
    }
  });
  return { months, rows, missing, gaps };
}

const markCls = m => ({ '✓': 'in', '○': 'muted' }[m] || 'out');
const when = s => s.period.start === s.period.end ? nice(s.period.end) : esc(nice(s.period.start)) + ' – ' + esc(nice(s.period.end));

/** A collapsible list with its count in the title, e.g. "Amex (14)". Closed by default unless something in it needs a look
 *  (a statement that does not add up, or a file waiting for a name); once you open or close one, the app remembers. */
const openMap = () => store.get('openGroups', {});
function grp(key, title, list, inner, meta = '') {
  const attention = list.some(s => (!s.ok && !s.csv && !s.acked) || s.held || (s.csv && !s.csv.acct));
  const m = openMap(); const open = key in m ? m[key] : attention;
  const bad = list.filter(s => !s.csv && !s.ok && !s.acked).length;
  return `<details class="grp" data-grp="${esc(key)}" ${open ? 'open' : ''}><summary><span class="gt">${title} <span class="muted">(${list.length})</span></span><span class="gm small">${bad ? `<span class="out">⚠ ${bad}</span> ` : ''}${list.length ? esc(nice(list.map(x => x.period.end).sort().pop()).replace(/^\d+ /, '')) : ''}${meta}</span></summary>${inner}</details>`;
}

/** One statement in a list. A CSV, or a statement that does not add up, opens a sheet when tapped. */
function rowHtml(s) {
  const mark = s.csv ? s.csv.mark : s.ok ? '✓' : '⚠';
  const tap = s.csv || (MONEY.includes(s.type) && (!s.ok || s.held)); // only these open a sheet (js/stmtsheet.js)
  const state = s.held ? ' · left out of your figures' : s.acked ? ' · kept, checked by you' : '';
  return `<li class="${tap ? 'tap' : ''}" ${tap ? `data-act="stmt-open" data-v="${esc(s.id)}"` : ''}><div class="who"><b>${when(s)}</b><span>${esc(s.name)}${s.csv ? (s.csv.src === 'pdf' ? ' · PDF, other bank' : ' · CSV') : ''}${s.count ? ' · ' + s.count + ' transactions' : ''}${state}</span>${s.problems.length ? `<span class="out">${s.problems.map(esc).join('<br>')}</span>` : ''}${tap && !s.csv ? '<span>Tap to review</span>' : ''}</div><span class="${s.csv ? markCls(mark) : s.ok ? 'in' : 'out'}" data-act="marks-help" style="font-size:18px;cursor:pointer" title="${esc(s.csv ? MARK_TEXT[mark] || '' : s.ok ? 'Checked' : 'Does not add up')}">${mark}</span><button class="btn ghost slim" data-act="ignore" data-v="${esc(s.id)}" aria-label="Remove from app">✕</button></li>`;
}

/** CSV statements, by the account they were given. Ones with no account yet wait at the top, out of every figure. */
function csvSection(list) {
  if (!list.length) return '';
  const wait = list.filter(s => !s.csv.acct), by = {};
  list.filter(s => s.csv.acct).forEach(s => { (by[s.csv.acct.id] = by[s.csv.acct.id] || { acct: s.csv.acct, list: [] }).list.push(s); });
  return `${wait.length ? grp('csv-wait', 'CSV files waiting for an account name', wait, `<div class="card"><p class="muted small" style="margin:0 0 8px">These were read but are not in your figures until you say which account they are from.</p><ul class="list">${wait.map(s => rowHtml(s).replace('<button class="btn ghost slim" data-act="ignore"', `<button class="btn slim" data-act="csv-name" data-v="${esc(s.id)}">Name</button><button class="btn ghost slim" data-act="ignore"`)).join('')}</ul></div>`) : ''}
    ${Object.values(by).map(g => grp('acct-' + g.acct.id, esc(g.acct.name), g.list, `<div class="card"><p class="muted small" style="margin:0 0 6px">${g.acct.kind === 'card' ? 'Credit card' : 'Current account'}${g.acct.link ? ', same account as your PDF statements' : ''}</p><ul class="list">${g.list.slice().reverse().map(rowHtml).join('')}</ul></div>`)).join('')}`;
}

export function renderData() {
  // remember which lists you opened or closed
  setTimeout(() => $('#view-data').querySelectorAll('details.grp').forEach(d => d.addEventListener('toggle', () => { const m = openMap(); m[d.dataset.grp] = d.open; store.set('openGroups', m); })), 0);
  const el = $('#view-data');
  const list = inScope();
  const cov = list.some(s => s.type !== 'csv') ? coverage(list) : null; // the coverage grid is for the statements that count; CSVs wait for account setup
  const repays = S.txns.filter(t => t.repayStatus).slice(-6).reverse();
  const lastIsa = S.isa[S.isa.length - 1], lastPen = S.pension[S.pension.length - 1];
  const badge = c => ({ ok: '<span class="cell ok">✓</span>', chk: '<span class="cell chk">⚠</span>', miss: '<span class="cell miss">✗</span>', due: '<span class="cell na">·</span>' })[c];
  const groups = [['santander', 'Joint account (Santander)'], ['monzo', 'Monzo personal account'], ['amex', 'Amex'], ['tesco', 'Tesco credit card'], ['payslip', 'Payslips'], ['moneyfarm', 'Moneyfarm ISA'], ['aviva', 'Pension']];
  el.innerHTML = `
    ${scopeBar()}
    <h2>Add statements</h2>
    <div class="card stack">
      <button class="btn" data-act="add-local" ${S.loading ? 'disabled' : ''}>Add statements</button>
      <p class="muted small" style="margin:0">Opens your phone's file chooser. Choose any folder on your phone (such as Downloads) or open <b>Google Drive</b>, then open a statements folder, then <b>⋮ → Select all</b> and tap <b>Select</b>. PDFs and CSV files both work, and can be mixed. <b>Or:</b> in the Google Drive app, select the statements, tap <b>Share → Ledger</b>. Choose the whole folder every time if you like: the app recognises statements it has already read and only reads new ones. Nothing is uploaded.</p>
    </div>
    ${lastImportCard(S.lastImport)}
    ${cov ? `<h2>Statement coverage</h2>
    <div class="card"><div class="grid"><span></span>${cov.months.map(m => `<span class="h">${MON[+m.slice(5) - 1]}</span>`).join('')}
      ${cov.rows.map(r => `<span>${esc(r.label)}</span>${r.cells.map(badge).join('')}`).join('')}</div>
      <p class="muted small" style="margin:10px 0 0">✓ read and adds up · ⚠ read, but a total doesn't match · ✗ missing · · not due yet · <a href="#" data-act="marks-help">What do the marks mean?</a></p>
      <div class="small" style="margin-top:6px">Moneyfarm: ${lastIsa ? `latest to ${nice(lastIsa.period.end)} ${lastIsa.ok ? '✓' : '⚠'}` : 'none'} · Pension: ${lastPen ? `annual to ${nice(lastPen.period.end)} ${lastPen.ok ? '✓' : '⚠'}` : 'none'}</div></div>
    ${cov.missing.length || cov.gaps.length ? `<div class="card notice small">${cov.missing.length ? `<b>Missing:</b> ${cov.missing.map(esc).join(', ')}.` : ''}${cov.gaps.length ? `<br><b>Gap in bank statements:</b> ${cov.gaps.map(esc).join('; ')}.` : ''}</div>` : `<div class="card notice good small">Everything up to date.</div>`}
    ${repays.length ? `<h2>Card repayments from the joint account</h2><div class="card"><ul class="list">${repays.map(t => `<li class="tap" data-act="txn" data-v="${t.key}"><div class="who"><b>${/AMERICAN EXP|AMEX/i.test(t.desc) ? 'Amex' : 'Tesco'} · paid ${niceShort(t.date)}</b><span>${t.repayStatus === 'matched' ? 'matches the card statement balance' : t.repayStatus === 'covered' ? 'card statements loaded, no exact balance match' : 'no card statement yet: counted as spending'}</span></div><span class="${t.repayStatus === 'matched' ? 'in' : t.repayStatus === 'covered' ? 'muted' : 'out'}">${gbp(-t.amount)} ${t.repayStatus === 'matched' ? '✓' : '?'}</span></li>`).join('')}</ul></div>` : ''}` : ''}

    ${S.ignored.length ? `<div class="card small"><span class="muted">${S.ignored.length} file${S.ignored.length === 1 ? '' : 's'} removed from the app and left out when you add PDFs.</span> <button class="btn ghost slim" data-act="unignore">Use them again</button></div>` : ''}
    ${S.continuity && S.continuity.length ? `<div class="card notice small"><b>Check these CSV accounts:</b><br>${S.continuity.map(c => esc(c.text)).join('<br>')}</div>` : ''}
    ${csvSection(inScope().filter(s => s.type === 'csv'))}
    ${groups.map(([type, label]) => { const list = inScope().filter(s => s.type === type).slice().reverse(); return list.length ? grp('t-' + type, label, list, `<div class="card"><ul class="list">${list.map(rowHtml).join('')}</ul></div>`) : ''; }).join('')}
    ${S.skipped.length ? `<h2>Not used (${S.skipped.length})</h2><div class="card small"><ul class="list">${S.skipped.map(s => `<li><div class="who"><b>${esc(s.name)}</b><span>${esc(s.why)}</span></div>${s.id ? `<button class="btn ghost slim" data-act="ignore" data-v="${esc(s.id)}" aria-label="Remove from app">✕</button>` : ''}</li>`).join('')}</ul></div>` : ''}
    ${S.txns.length && !S.demo ? `<div class="card notice good small"><b>Saved on this phone, encrypted${S.meta && S.meta.mode === 'pin' ? ' and locked with your passcode' : ''}.</b> The statement PDFs themselves are never saved.</div>` : ''}`;
}
