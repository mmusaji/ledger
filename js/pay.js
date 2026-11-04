/* Pay screen (payslips). */
import { barChart, scopeBar } from './charts.js';
import { activeScope, isCurrent, scopeTxns } from './model.js';
import { S } from './state.js';
import { emptyState } from './ui.js';
import { $, MON, daysBetween, esc, gbp, gbp0, nice, niceShort, sum } from './util.js';

export function renderPay() {
  const el = $('#view-pay');
  // in a personal account only the payslips whose net pay arrived in that account are shown
  const ps = activeScope() === 'household' ? S.payslips : S.payslips.filter(x => scopeTxns().some(t => isCurrent(t) && t.amount === x.net && Math.abs(daysBetween(x.payDate, t.date)) <= 7));
  if (!ps.length) return emptyState(el, activeScope() === 'household' ? 'No payslips yet. Tick your payslips with Pick statements on the Statements tab.' : 'No payslips are paid into this account. Its income is money transferred in from the household account.', scopeBar());
  if (S.payIdx === null || S.payIdx >= ps.length) S.payIdx = ps.length - 1;
  const p = ps[S.payIdx];
  const gross = p.grossBeforePension;
  const segs = [['Net pay', p.net, 'k1'], ['Tax + NI', p.tax + p.ni + (p.rsuWithholding || 0), 'kr'], ['Pension', p.pensionEmployee, 'k3'], ['ESPP', p.espp, 'k2'], ['Other', p.otherDeductions, 'k4']].filter(s => s[1] > 0);
  const segTotal = sum(segs, s => s[1]) || 1;
  const bankHit = scopeTxns().find(t => isCurrent(t) && t.amount === p.net && Math.abs(daysBetween(p.payDate, t.date)) <= 7);
  const ty = p.payDate.slice(5) >= '04-06' ? +p.payDate.slice(0, 4) : +p.payDate.slice(0, 4) - 1;
  const inTy = ps.filter(x => x.payDate >= `${ty}-04-06` && x.payDate <= `${ty + 1}-04-05`);
  const tyPenYou = sum(inTy, x => x.pensionEmployee), tyPenEr = sum(inTy, x => x.pensionEmployer);
  const tyTax = sum(inTy, x => x.tax + (x.rsuWithholding || 0)), tyNi = sum(inTy, x => x.ni), tyNet = sum(inTy, x => x.net), tyGross = sum(inTy, x => x.grossBeforePension), tyEspp = sum(inTy, x => x.espp);
  const notional = (p.items || []).filter(x => x.kind === 'notional');
  const last12 = ps.slice(-12);
  el.innerHTML = `
    ${scopeBar()}
    <div class="chips">${ps.map((x, i) => `<button class="chip ${i === S.payIdx ? 'on' : ''}" data-act="payslip" data-v="${i}">${MON[+x.payDate.slice(5, 7) - 1]} ${x.payDate.slice(2, 4)}</button>`).slice(-14).join('')}</div>
    <div class="muted small">Paid ${nice(p.payDate)}${p.employer ? ' · ' + esc(p.employer) : ''}${p.ok ? '' : ' · <span class="out">⚠ ' + esc(p.problems[0] || 'check') + '</span>'}</div>
    <h2>Where your pay went</h2>
    <div class="card wf">
      <div class="r"><span>Basic pay</span><span class="num">${gbp(p.basic)}</span></div>
      ${p.car ? `<div class="r"><span>Car allowance</span><span class="num">${gbp(p.car)}</span></div>` : ''}
      ${p.variable ? `<div class="r"><span>Commission / variable</span><span class="num">${gbp(p.variable)}</span></div>` : ''}
      <div class="r"><b>Gross pay</b><b class="num">${gbp(gross)}</b></div>
      <div class="r"><span>Pension (salary sacrifice)</span><span class="num out">−${gbp(p.pensionEmployee)}</span></div>
      <div class="r"><span>Income tax${p.rsuWithholding ? ' (incl. RSU tax)' : ''}</span><span class="num out">−${gbp(p.tax + (p.rsuWithholding || 0))}</span></div>
      <div class="r"><span>National Insurance</span><span class="num out">−${gbp(p.ni)}</span></div>
      ${p.espp ? `<div class="r"><span>ESPP</span><span class="num out">−${gbp(p.espp)}</span></div>` : ''}
      ${p.otherDeductions ? `<div class="r"><span>Other deductions</span><span class="num out">−${gbp(p.otherDeductions)}</span></div>` : ''}
      <div class="r"><b>Net pay</b><b class="num in">${gbp(p.net)}</b></div>
      <div class="stackbar tall">${segs.map(s => `<i class="${s[2]}" style="width:${(s[1] / segTotal * 100).toFixed(1)}%"></i>`).join('')}</div>
      <div class="legend">${segs.map(s => `<span><i class="${s[2]}"></i>${s[0]} ${Math.round(s[1] / segTotal * 100)}%</span>`).join('')}</div>
      <div class="small ${bankHit ? 'in' : 'muted'}" style="margin-top:8px">${bankHit ? `✓ Landed in the joint account on ${niceShort(bankHit.date)}` : 'Not matched to a salary payment in the bank statements yet.'}</div>
    </div>
    ${p.pensionEmployer ? `<div class="card small">Your employer also paid <b>${gbp(p.pensionEmployer)}</b> into your pension this month, so <b>${gbp(p.pensionEmployee + p.pensionEmployer)}</b> went in altogether.</div>` : ''}
    ${p.rsuIncome ? `<div class="card small notice">RSU vest this month: <b>${gbp(p.rsuIncome)}</b> taxed through payroll (shown on the payslip but not paid as cash). The share sale proceeds arrive separately.</div>` : ''}
    ${notional.length ? `<div class="card small muted">Shown on the payslip but not paid: ${notional.map(x => `${esc(x.label)} ${gbp(x.amount)}`).join(' · ')}</div>` : ''}

    <h2>Tax year ${ty}/${String(ty + 1).slice(2)} so far (${inTy.length} payslip${inTy.length === 1 ? '' : 's'})</h2>
    <div class="kpis">
      <div class="kpi"><div class="label">Gross pay</div><div class="value">${gbp0(tyGross)}</div></div>
      <div class="kpi"><div class="label">Net pay</div><div class="value in">${gbp0(tyNet)}</div></div>
      <div class="kpi"><div class="label">Tax + NI</div><div class="value out">${gbp0(tyTax + tyNi)}</div><div class="sub">tax ${gbp0(tyTax)} · NI ${gbp0(tyNi)}</div></div>
      <div class="kpi"><div class="label">Pension</div><div class="value">${gbp0(tyPenYou + tyPenEr)}</div><div class="sub">you ${gbp0(tyPenYou)} + employer ${gbp0(tyPenEr)}</div></div>
      <div class="kpi"><div class="label">ESPP</div><div class="value">${gbp0(tyEspp)}</div></div>
      <div class="kpi"><div class="label">Kept from gross</div><div class="value">${tyGross ? Math.round(tyNet / tyGross * 100) : 0}%</div><div class="sub">net ÷ gross</div></div>
    </div>
    ${last12.length > 1 ? `<h2>Net pay by month</h2><div class="card chart">${barChart(last12.map(x => ({ label: MON[+x.payDate.slice(5, 7) - 1], a: x.net, b: x.variable })), 'Net pay', 'Variable pay')}<div class="legend"><span><i style="background:var(--bar1)"></i>Net pay</span><span><i style="background:var(--bar2)"></i>Commission / variable (gross)</span></div></div>` : ''}`;
  const ch = el.querySelector('.chips'); if (ch) ch.scrollLeft = ch.scrollWidth;
}
