/* Savings screen (ISA, pension, savings transfers). */
import { lineChart } from './charts.js';
import { householdTxns } from './model.js';
import { S } from './state.js';
import { emptyState } from './ui.js';
import { $, esc, gbp, gbp0, nice, niceShort, sum, today } from './util.js';

export function renderSavings() {
  const el = $('#view-savings');
  if (!S.isa.length && !S.pension.length && !S.txns.length) return emptyState(el, 'No investment statements yet');
  const isa = S.isa[S.isa.length - 1];
  const pen = S.pension[S.pension.length - 1];
  const now = today(); const ty = now.slice(5) >= '04-06' ? +now.slice(0, 4) : +now.slice(0, 4) - 1;
  const isaTy = S.isa.flatMap(x => x.contributions || []).filter(c => c.date >= `${ty}-04-06`);
  const isaTyIn = [...new Map(isaTy.map(c => [c.date + c.amount, c])).values()].reduce((s, c) => s + c.amount, 0);
  const penSince = pen ? S.payslips.filter(p => p.payDate > pen.period.end) : [];
  const penSinceAmt = sum(penSince, p => p.pensionEmployee + p.pensionEmployer);
  const savTx = householdTxns().filter(t => t.group === 'saving' && t.date >= `${ty}-04-06`);
  const byDest = {}; savTx.forEach(t => { byDest[t.payee] = (byDest[t.payee] || 0) - t.amount; });
  el.innerHTML = `
    <h2>Moneyfarm ISA</h2>
    ${isa ? `<div class="card">
      <div class="row"><span>Value at ${nice(isa.period.end)}</span><b class="num big">${gbp(isa.end)}</b></div>
      <div class="muted small">Quarter: started ${gbp0(isa.start)} · paid in ${gbp0(isa.paidIn)} · return ${gbp(isa.investmentReturn, true)} · fees ${gbp(isa.fees || 0)}</div>
      <div class="chart" style="margin-top:8px">${lineChart(S.isa.map(x => ({ d: x.period.end, v: x.end })), 'ISA value')}</div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="label">ISA allowance left</div><div class="value">${isa.isaAllowanceLeft !== null && isa.isaAllowanceLeft !== undefined ? gbp0(isa.isaAllowanceLeft) : '—'}</div><div class="sub">per Moneyfarm, ${niceShort(isa.period.end)}</div></div>
      <div class="kpi"><div class="label">Paid in this tax year</div><div class="value">${gbp0(isaTyIn)}</div><div class="sub">from statements</div></div>
      <div class="kpi"><div class="label">Fees (all statements)</div><div class="value">${gbp0(-sum(S.isa, x => x.fees || 0))}</div><div class="sub">${S.isa.length} quarter${S.isa.length === 1 ? '' : 's'}</div></div>
    </div>` : '<div class="card muted small">No ISA statements yet. Add them with Add statements on the Documents tab.</div>'}

    <h2>Workplace pension</h2>
    ${pen ? `<div class="card">
      <div class="row"><span>Value at ${nice(pen.period.end)}</span><b class="num big">${gbp(pen.end)}</b></div>
      <div class="muted small">Year to ${niceShort(pen.period.end)}: started ${gbp0(pen.start)} · paid in ${gbp0(pen.paidIn)} · growth ${gbp(pen.growth, true)} · charges ${gbp(pen.charges)}</div>
      ${penSince.length ? `<div class="small" style="margin-top:8px">Since then your payslips show <b>${gbp(penSinceAmt)}</b> more paid in (${penSince.length} month${penSince.length === 1 ? '' : 's'}, you + employer). The value itself updates when the next annual statement arrives.</div>` : ''}
    </div>
    ${pen.projectedPot ? `<div class="kpis"><div class="kpi"><div class="label">Projected pot</div><div class="value">${gbp0(pen.projectedPot)}</div><div class="sub">at ${esc(pen.retirementDate || 'retirement')}, Aviva's example</div></div>
      <div class="kpi"><div class="label">Example yearly income</div><div class="value">${gbp0(pen.projectedIncome)}</div><div class="sub">in today's money, not guaranteed</div></div></div>` : ''}` : '<div class="card muted small">No pension statement yet. Tick it with Pick statements on the Statements tab.</div>'}

    <h2>From the joint account this tax year</h2>
    <div class="card">${Object.keys(byDest).length ? `<ul class="list">${Object.entries(byDest).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<li><div class="who"><b>${esc(k)}</b></div><span class="num">${gbp(v)}</span></li>`).join('')}</ul><div class="muted small">Net of money taken back out. A negative figure means more came out than went in.</div>` : '<span class="muted small">No savings transfers found.</span>'}</div>`;
}
