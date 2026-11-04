/* Statements screen: what has been added, what is missing, card repayments. */
import { S } from './state.js';
import { $, MON, addDays, daysBetween, esc, gbp, isoOf, monthLabel, nice, niceShort, pad, today } from './util.js';

const TYPES = [['santander', 'Santander', 5], ['amex', 'Amex', 19], ['tesco', 'Tesco CC', 24], ['payslip', 'Payslips', 26]];

function coverage() {
  const end = today(); const months = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(end + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); months.push(isoOf(d).slice(0, 7)); }
  const rows = TYPES.map(([type, label, day]) => ({ type, label, cells: months.map(m => {
    const st = S.statements.filter(s => s.type === type && s.period.end.slice(0, 7) === m);
    if (st.length) return st.every(s => s.ok) ? 'ok' : 'chk';
    const due = addDays(`${m}-${pad(Math.min(day, 28))}`, 4);
    return end < due ? 'due' : 'miss';
  }) }));
  const missing = [];
  rows.forEach(r => r.cells.forEach((c, i) => { if (c === 'miss') missing.push(`${r.label} ${monthLabel(months[i])}`); }));
  // gaps between consecutive bank statements
  const bank = S.statements.filter(s => s.type === 'santander');
  const gaps = [];
  for (let i = 1; i < bank.length; i++) {
    if (daysBetween(bank[i - 1].period.end, bank[i].period.start) > 3) gaps.push(`${niceShort(addDays(bank[i - 1].period.end, 1))} – ${nice(addDays(bank[i].period.start, -1))}`);
    else if (bank[i - 1].closing !== undefined && bank[i].opening !== undefined && bank[i - 1].closing !== bank[i].opening) gaps.push(`balance doesn't carry over between ${niceShort(bank[i - 1].period.end)} and ${niceShort(bank[i].period.start)}`);
  }
  return { months, rows, missing, gaps };
}

export function renderData() {
  const el = $('#view-data');
  const cov = S.statements.length ? coverage() : null;
  const repays = S.txns.filter(t => t.repayStatus).slice(-6).reverse();
  const lastIsa = S.isa[S.isa.length - 1], lastPen = S.pension[S.pension.length - 1];
  const badge = c => ({ ok: '<span class="cell ok">✓</span>', chk: '<span class="cell chk">⚠</span>', miss: '<span class="cell miss">✗</span>', due: '<span class="cell na">·</span>' })[c];
  const groups = [['santander', 'Joint account (Santander)'], ['amex', 'Amex'], ['tesco', 'Tesco credit card'], ['payslip', 'Payslips'], ['moneyfarm', 'Moneyfarm ISA'], ['aviva', 'Pension']];
  el.innerHTML = `
    <h2>Add statements</h2>
    <div class="card stack">
      <button class="btn" data-act="add-local" ${S.loading ? 'disabled' : ''}>Add PDFs</button>
      <p class="muted small" style="margin:0">Opens your phone's file chooser. Choose any folder on your phone (such as Downloads) or open <b>Google Drive</b>, then open a statements folder, then <b>⋮ → Select all</b> and tap <b>Select</b>. <b>Or:</b> in the Google Drive app, select the PDFs, tap <b>Share → Ledger</b>. Choose the whole folder every time if you like: the app recognises statements it has already read and only reads new ones. Nothing is uploaded.</p>
    </div>
    ${cov ? `<h2>Statement coverage</h2>
    <div class="card"><div class="grid"><span></span>${cov.months.map(m => `<span class="h">${MON[+m.slice(5) - 1]}</span>`).join('')}
      ${cov.rows.map(r => `<span>${esc(r.label)}</span>${r.cells.map(badge).join('')}`).join('')}</div>
      <p class="muted small" style="margin:10px 0 0">✓ read and adds up · ⚠ read, but a total doesn't match · ✗ missing · · not due yet</p>
      <div class="small" style="margin-top:6px">Moneyfarm: ${lastIsa ? `latest to ${nice(lastIsa.period.end)} ${lastIsa.ok ? '✓' : '⚠'}` : 'none'} · Pension: ${lastPen ? `annual to ${nice(lastPen.period.end)} ${lastPen.ok ? '✓' : '⚠'}` : 'none'}</div></div>
    ${cov.missing.length || cov.gaps.length ? `<div class="card notice small">${cov.missing.length ? `<b>Missing:</b> ${cov.missing.map(esc).join(', ')}.` : ''}${cov.gaps.length ? `<br><b>Gap in bank statements:</b> ${cov.gaps.map(esc).join('; ')}.` : ''}</div>` : `<div class="card notice good small">Everything up to date.</div>`}
    ${repays.length ? `<h2>Card repayments from the joint account</h2><div class="card"><ul class="list">${repays.map(t => `<li class="tap" data-act="txn" data-v="${t.key}"><div class="who"><b>${/AMERICAN EXP|AMEX/i.test(t.desc) ? 'Amex' : 'Tesco'} · paid ${niceShort(t.date)}</b><span>${t.repayStatus === 'matched' ? 'matches the card statement balance' : t.repayStatus === 'covered' ? 'card statements loaded, no exact balance match' : 'no card statement yet: counted as spending'}</span></div><span class="${t.repayStatus === 'matched' ? 'in' : t.repayStatus === 'covered' ? 'muted' : 'out'}">${gbp(-t.amount)} ${t.repayStatus === 'matched' ? '✓' : '?'}</span></li>`).join('')}</ul></div>` : ''}` : ''}

    ${S.ignored.length ? `<div class="card small"><span class="muted">${S.ignored.length} file${S.ignored.length === 1 ? '' : 's'} removed from the app and left out when you add PDFs.</span> <button class="btn ghost slim" data-act="unignore">Use them again</button></div>` : ''}
    ${groups.map(([type, label]) => { const list = S.statements.filter(s => s.type === type).slice().reverse(); return list.length ? `<h2>${label} (${list.length})</h2>
    <div class="card"><ul class="list">${list.map(s => `<li><div class="who"><b>${s.period.start === s.period.end ? nice(s.period.end) : esc(nice(s.period.start)) + ' – ' + esc(nice(s.period.end))}</b><span>${esc(s.name)}${s.count ? ' · ' + s.count + ' transactions' : ''}</span>${s.problems.length ? `<span class="out">${s.problems.map(esc).join('<br>')}</span>` : ''}</div><span class="${s.ok ? 'in' : 'out'}">${s.ok ? '✓' : '⚠'}</span><button class="btn ghost slim" data-act="ignore" data-v="${esc(s.id)}" aria-label="Remove from app">✕</button></li>`).join('')}</ul></div>` : ''; }).join('')}
    ${S.skipped.length ? `<h2>Not used (${S.skipped.length})</h2><div class="card small"><ul class="list">${S.skipped.map(s => `<li><div class="who"><b>${esc(s.name)}</b><span>${esc(s.why)}</span></div>${s.id ? `<button class="btn ghost slim" data-act="ignore" data-v="${esc(s.id)}" aria-label="Remove from app">✕</button>` : ''}</li>`).join('')}</ul></div>` : ''}
    ${S.txns.length && !S.demo ? `<div class="card notice good small"><b>Saved on this phone, encrypted${S.meta && S.meta.mode === 'pin' ? ' and locked with your passcode' : ''}.</b> The statement PDFs themselves are never saved.</div>` : ''}`;
}
