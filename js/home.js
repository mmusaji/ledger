/* Dashboard screen. */
import { barChart, bars, lineChart, personCls, scopeBar } from './charts.js';
import { GROUP_OF } from './deps.js';
import { accIdOf, accountName, activeScope, balanceSeries, inRange, isCurrent, isSpend, oneOff, personalAccounts, rangeFor, scopeStatements, scopeTxns } from './model.js';
import { cycleShort } from './period.js';
import { S } from './state.js';
import { figuresNotice } from './notices.js';
import { emptyState } from './ui.js';
import { $, esc, gbp, gbp0, nice, niceShort, ordinal, personOf, sum } from './util.js';

export function renderHome() {
  const el = $('#view-home');
  if (!S.txns.length) return emptyState(el);
  const r = rangeFor(S.period); if (!r) return emptyState(el, 'No bank statements yet');
  const sc = activeScope(), mz = sc !== 'household';
  const scAcc = personalAccounts().find(a => a.id === sc);
  const base = scopeTxns();
  const all = base.filter(t => inRange(t, r));
  const offs = all.filter(oneOff);
  const tx = S.hideOneOffs ? all.filter(t => !oneOff(t)) : all;
  const income = sum(tx.filter(t => t.group === 'income'));
  const spendTx = tx.filter(isSpend);
  const spending = -sum(spendTx);
  const saved = -sum(tx.filter(t => t.group === 'saving'));
  const fullSeries = balanceSeries(base.filter(isCurrent));
  const series = fullSeries.filter(p => p.date >= r.from && p.date <= r.to);
  const before = fullSeries.filter(p => p.date < r.from).pop(); // the balance carried into the period
  const potNet = -sum(tx.filter(t => t.pot));
  const lastMz = scopeStatements().filter(s => s.type === 'monzo').pop();
  const last = series.length ? { balance: series[series.length - 1].v, date: series[series.length - 1].date } : null;
  const low = series.reduce((m, p) => (!m || p.v < m.balance ? { balance: p.v, date: p.date } : m), null);
  const odDays = new Set(series.filter(p => p.v < 0).map(p => p.date)).size;
  const unmatched = all.filter(t => t.repayStatus === 'nocard');
  const latestOf = type => (type === 'santander' ? scopeStatements().filter(s => s.type === 'santander' || s.type === 'csv') : S.statements.filter(s => s.type === type)).map(s => s.period.end).sort().pop(); // 'santander' = the household's bank statements, PDF or CSV
  const synced = S.lastSync ? new Date(S.lastSync).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  // who spent what
  const byPerson = {};
  spendTx.forEach(t => { const p = personOf(t.account); byPerson[p] = byPerson[p] || { total: 0, acc: {} }; byPerson[p].total -= t.amount; byPerson[p].acc[t.account] = (byPerson[p].acc[t.account] || 0) - t.amount; });
  const people = Object.entries(byPerson).sort((a, b) => b[1].total - a[1].total);
  const maxP = Math.max(1, ...people.map(([, v]) => v.total));
  // by category
  const byCat = {};
  spendTx.forEach(t => { byCat[t.category] = (byCat[t.category] || 0) - t.amount; });
  const catRows = Object.entries(byCat).filter(([, v]) => v > 0).map(([k, v]) => ({ k, v, cls: GROUP_OF[k] === 'cards' ? 'cards' : '' })).sort((a, b) => b.v - a.v);
  // per pay month
  const perCycle = r.keys.map(k => {
    const t2 = base.filter(t => t.cycle === k && (!S.hideOneOffs || !oneOff(t)));
    return { label: cycleShort(k), a: sum(t2.filter(t => t.group === 'income')), b: -sum(t2.filter(isSpend)) };
  });
  // regular payments from the latest bank statement
  // each household account's latest statement
  const lbs = mz ? [] : Object.values(scopeStatements().filter(s => s.type === 'santander').reduce((o, s) => { o[accIdOf(s)] = s; return o; }, {}));
  const reg = lbs.length ? base.filter(t => t.type === 'bank' && lbs.some(lb => accIdOf(lb) === t.accId && t.date >= lb.period.start && t.date <= lb.period.end) && t.amount < 0 && (t.kind === 'Direct debit' || t.kind === 'Standing order')) : [];
  const regTotal = -sum(reg);
  const byDay = {}; reg.forEach(t => { const d = +t.date.slice(8); byDay[d] = (byDay[d] || 0) - t.amount; });
  const peak = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
  // top payees
  const byPayee = {};
  spendTx.filter(t => t.amount < 0).forEach(t => { byPayee[t.payee] = (byPayee[t.payee] || 0) - t.amount; });
  const payees = Object.entries(byPayee).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const pc = [['latest', 'Pay month'], ['3', '3 months'], ['6', '6 months'], ['12', '12 months'], ['tax', 'Tax year'], ['all', 'All']];

  el.innerHTML = `
    ${S.demo ? `<div class="card notice small">You are looking at <b>invented sample data</b>. Add your statements from the Statements tab.</div>` :
      `<div class="row small"><span class="muted">${S.loading ? 'Reading…' : 'Updated ' + esc(synced)}</span><button class="btn ghost slim" data-act="add-local" ${S.loading ? 'disabled' : ''}>Add statements</button></div>`}
    ${scopeBar()}${figuresNotice()}
    <div class="chips" role="tablist">${pc.map(([k, l]) => `<button class="chip ${S.period === k ? 'on' : ''}" data-act="period" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="muted small">${esc(r.label)}<br>${mz ? `${esc(scAcc ? accountName(scAcc) : 'Account')} to ${(() => { const e = scopeStatements().map(s => s.period.end).sort().pop(); return e ? niceShort(e) : '—'; })()}` : `Bank to ${latestOf('santander') ? niceShort(latestOf('santander')) : '—'} · Amex to ${latestOf('amex') ? niceShort(latestOf('amex')) : '—'} · Tesco to ${latestOf('tesco') ? niceShort(latestOf('tesco')) : '—'}`}</div>
    ${(r.outside || []).length ? `<div class="card notice small">${r.outside.length} pay month${r.outside.length === 1 ? ' is' : 's are'} left out because not every household account has statements for ${r.outside.length === 1 ? 'it' : 'them'}.</div>` : ''}
    ${(r.part || []).map(x => `<div class="card notice small">The pay month starting ${esc(nice(x.start))} is only part covered by your ${mz ? 'account' : 'bank'} statements (${esc(niceShort(x.from))} – ${esc(niceShort(x.to))}), so it is left out of the totals until the rest is added.</div>`).join('')}
    <div class="kpis">
      <div class="kpi"><div class="label">Income</div><div class="value in">${gbp0(income)}</div><div class="sub">${mz ? 'money in, incl. from the household account' : 'salary, shares, contributions'}</div></div>
      <div class="kpi"><div class="label">Spending</div><div class="value out">${gbp0(spending)}</div><div class="sub">${mz ? 'this account, incl. to the household account' : 'bank + all cards'}${S.hideOneOffs ? ', no one-offs' : ''}</div></div>
      <div class="kpi"><div class="label">Left over</div><div class="value ${income - spending >= 0 ? 'in' : 'out'}">${gbp0(income - spending)}</div><div class="sub">income − spending</div></div>
      <div class="kpi"><div class="label">One-offs</div><div class="value">${gbp0(-sum(offs))}</div><div class="sub">${offs.length} item${offs.length === 1 ? '' : 's'} ≥ £500</div></div>
      ${mz ? `<div class="kpi"><div class="label">Moved to pots (net)</div><div class="value">${gbp0(potNet)}</div><div class="sub">not counted as spending</div></div>` : `<div class="kpi"><div class="label">Into savings (net)</div><div class="value">${gbp0(saved)}</div><div class="sub">savings, ISA, T212, JISA</div></div>`}
      <div class="kpi"><div class="label">${mz ? 'Account balance' : 'Bank balance'}</div><div class="value">${last ? gbp0(last.balance) : '—'}</div><div class="sub">${last ? 'at ' + niceShort(last.date) + (mz ? ', excluding pots' : '') : ''}</div></div>
    </div>
    <div class="card toggle" data-act="toggle-oneoffs" role="switch" aria-checked="${S.hideOneOffs}"><span>Hide one-off payments (£500+)</span><span class="sw ${S.hideOneOffs ? 'on' : ''}"></span></div>
    ${unmatched.length ? `<div class="card notice small">${unmatched.length} card repayment${unmatched.length > 1 ? 's' : ''} (${gbp(-sum(unmatched))}) counted as spending because the card statement for that month isn't in Drive.</div>` : ''}

    ${mz && lastMz && lastMz.pots != null ? `<div class="card small"><div class="row"><b>Balance in pots</b><b class="num">${gbp(lastMz.pots)}</b></div><div class="muted">At ${esc(nice(lastMz.period.end))}. Includes savings pots held with other providers. Pots are not part of the household figures.</div></div>` : ''}

    <h2>Who spent what</h2>
    <div class="card">${people.map(([p, v]) => `
      <div class="person"><div class="row"><b>${esc(p)}</b><b class="num">${gbp(v.total)}</b></div>
      <div class="stackbar"><i class="${personCls(p)}" style="width:${(v.total / maxP * 100).toFixed(1)}%"></i></div>
      <div class="muted small">${Object.entries(v.acc).sort((a, b) => b[1] - a[1]).map(([a, x]) => `${esc(a === 'Joint account' ? 'Bank' : a.split(' · ')[0])} ${gbp(x)}`).join(' · ')}</div></div>`).join('')}
    </div>

    ${perCycle.length > 1 ? `<h2>Income vs spending by pay month</h2><div class="card chart">${barChart(perCycle)}<div class="legend"><span><i style="background:var(--bar1)"></i>Income</span><span><i style="background:var(--bar2)"></i>Spending</span></div></div>` : ''}

    <h2>Where the money went</h2>
    <div class="card">${catRows.length ? bars(catRows, spending, 'cat') : '<span class="muted">No spending in this period.</span>'}
      <p class="muted small" style="margin:8px 0 0">Tap a category to see its transactions.</p></div>

    ${low ? `<h2>Bank balance</h2><div class="card ${low.balance < 0 ? 'notice bad' : 'notice good'}">
      <div class="row"><b>Lowest</b><span class="num ${low.balance < 0 ? 'out' : ''}">${gbp(low.balance)}</span></div>
      <div class="muted small">${nice(low.date)}${low.balance < 0 ? ` · overdrawn on ${odDays} day${odDays === 1 ? '' : 's'}` : ' · never overdrawn in this period'}</div>
      <div class="chart" style="margin-top:8px">${lineChart([...(before ? [{ d: r.from, v: before.v }] : []), ...series.map(p => ({ d: p.date, v: p.v })), { d: r.to, v: series[series.length - 1].v }], 'Account balance', { from: r.from, to: r.to })}</div></div>` : ''}

    ${reg.length ? `<h2>Direct debits &amp; standing orders</h2>
    <div class="card">
      <div class="row"><span>Each month</span><b class="num">${gbp(regTotal)}</b></div>
      ${peak ? `<div class="muted small" style="margin-top:4px">Biggest day: <b>${gbp(peak[1])}</b> leaves on the ${ordinal(+peak[0])}. Have at least this in the account the day before.</div>` : ''}
      <ul class="list" style="margin-top:8px">${reg.slice().sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount).map(t => `<li class="tap" data-act="txn" data-v="${t.key}"><div class="who"><b>${esc(t.payee)}</b><span>${ordinal(+t.date.slice(8))} · ${esc(t.category)}</span></div><span class="num out">${gbp(t.amount)}</span></li>`).join('')}</ul>
    </div>` : ''}

    <h2>Top payees</h2>
    <div class="card"><ul class="list">${payees.map(([p, v]) => `<li class="tap" data-act="payee" data-v="${esc(p)}"><div class="who"><b>${esc(p)}</b></div><span class="num">${gbp(v)}</span></li>`).join('') || '<li class="muted">None</li>'}</ul></div>`;
}
