/* Invented sample data so the app can be explored before any statements are added. */
import { P, RD } from './deps.js';
import { rebuild } from './model.js';
import { S } from './state.js';
import { render, statusLine } from './ui.js';
import { MON, addDays, isoOf, sum } from './util.js';

export function loadDemo() {
  const rnd = (a, b) => Math.round(a + Math.random() * (b - a));
  const files = {}; let bal = 180000; let id = 0;
  const add = r => { files['demo' + (id++)] = { name: r.name, result: r }; };
  const base = new Date(); base.setUTCDate(5); base.setUTCMonth(base.getUTCMonth() - 1);
  for (let k = 5; k >= 0; k--) {
    const e = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - k, 5));
    const s = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() - 1, 6));
    const d = n => isoOf(new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 6 + n)));
    const amexClose = rnd(200000, 380000), tescoClose = rnd(150000, 260000);
    const rows = [
      [2, 'TRANSFER FROM SAMPLE PERSONAL ACCOUNT', 50000], [4, 'DIRECT DEBIT PAYMENT TO VIRGIN MEDIA PYMTS REF 1, MANDATE NO 0031', -3900],
      [4, 'DIRECT DEBIT PAYMENT TO O2 REF D1, MANDATE NO 0051', -1500], [6, 'Third party payment made via Faster Payment to SAMPLE CLEANING Reference 1', -5700],
      [13, 'DIRECT DEBIT PAYMENT TO SCOTTISHPOWER REF 1, MANDATE NO 0043', -2950], [rnd(1, 20), 'CASH WITHDRAWAL AT SAMPLE ATM, SAMPLETOWN,100.00 GBP , ON 08-08-2026', -rnd(5, 15) * 1000],
      [19, 'BANK GIRO CREDIT REF ACME UK LTD, SALARY', 760000], [20, 'Third party payment made via Faster Payment to TESCO BANK Reference 1', -tescoClose],
      [20, 'Third party payment made via Faster Payment to AMERICAN EXP 3773 Reference PB1', -amexClose], [22, 'DIRECT DEBIT PAYMENT TO L&G INSURANCE MI REF 1, MANDATE NO 0062', -4246],
      [25, 'REGULAR TRANSFER PAYMENT TO ACCOUNT SAVING R1, MANDATE NO 140', -20000], [25, 'DIRECT DEBIT PAYMENT TO EDF ENERGY REF A-1, MANDATE NO 0053', -rnd(15000, 37000)],
      [25, 'DIRECT DEBIT PAYMENT TO SANTANDER MORTGAGE REF 1, MANDATE NO 0035', -147055], [25, 'DIRECT DEBIT PAYMENT TO SEVERN TRENT WATER REF 1, MANDATE NO 0033', -7615],
      [25, 'DIRECT DEBIT PAYMENT TO SAMPLE BOROUGH COUNCIL REF 1, MANDATE NO 0036', -29600], [25, 'TRANSFER FROM SAMPLE PERSONAL ACCOUNT', 150000],
      [27, 'FASTER PAYMENTS RECEIPT REF.Contribution FROM Sample Relative', rnd(0, 1) ? 200000 : 0], [29, 'MAINTAINING THE ACCOUNT - MONTHLY FEE', -300]
    ].filter(r => r[2] !== 0).sort((a, b) => a[0] - b[0]);
    const opening = bal;
    const btx = rows.map(([n, desc, amount]) => { bal += amount; return { date: d(n), desc, amount, balance: bal, kind: P.kindOf(desc), payee: P.payeeOf(desc), account: 'Joint account', holder: 'Joint', type: 'bank' }; });
    add({ type: 'santander', institution: 'Santander', name: `Sample bank ${MON[e.getUTCMonth()]}`, period: { start: isoOf(s), end: isoOf(e) }, opening, closing: bal, txns: btx, ok: true, problems: [] });
    const merch = [['CO-OP - GROBY SAMPLETOWN', 'Person B', 900, 4500], ['TESCO STORE 1234 SAMPLETOWN', 'Person B', 2000, 9000], ['DELIVEROO LONDON', 'Person A', 1800, 4500], ['AMAZON.CO.UK*ABC', 'Person B', 800, 6000],
      ['AMAZON.CO.UK*XYZ', 'Person A', 1200, 9000], ['SHELL SAMPLE', 'Person A', 6000, 9500], ['ODEON SAMPLETOWN', 'Person B', 1800, 4800], ['PRIMARK SAMPLETOWN', 'Person B', 1500, 4000], ['CHAIIWALA SAMPLE', 'Person A', 700, 2500]];
    const ce = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), 19)); const cs = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() - 1, 20));
    const ctx = []; for (let i = 0; i < 26; i++) { const m = merch[rnd(0, merch.length - 1)]; const dd = isoOf(new Date(cs.getTime() + rnd(0, 29) * 864e5)); ctx.push({ date: dd, desc: m[0], amount: -rnd(m[2], m[3]), holder: m[1], account: 'Amex · ' + m[1], kind: 'Card purchase', type: 'card', payee: RD.cleanMerchant(m[0]) }); }
    add({ type: 'amex', institution: 'Amex', name: `Sample Amex ${MON[ce.getUTCMonth()]}`, period: { start: isoOf(cs), end: isoOf(ce) }, summary: { closing: -sum(ctx) }, txns: ctx, holders: ['Person A', 'Person B'], ok: true, problems: [] });
    const ttx = []; for (let i = 0; i < 18; i++) { const m = merch[rnd(0, merch.length - 1)]; const dd = isoOf(new Date(cs.getTime() + (5 + rnd(0, 29)) * 864e5)); ttx.push({ date: dd, desc: m[0], amount: -rnd(m[2], m[3]), holder: 'Person A', account: 'Tesco · Person A', kind: 'Card purchase', type: 'card', payee: RD.cleanMerchant(m[0]) }); }
    add({ type: 'tesco', institution: 'Tesco', name: `Sample Tesco ${MON[ce.getUTCMonth()]}`, period: { start: addDays(isoOf(cs), 5), end: addDays(isoOf(ce), 5) }, summary: { closing: -sum(ttx) }, txns: ttx, holders: ['Person A'], ok: true, problems: [] });
    const pd = d(19); const variable = rnd(0, 1) ? rnd(300000, 700000) : 0; const gross = 1000000 + 55000 + variable;
    const tax = Math.round((gross - 200000) * 0.38), ni = Math.round((gross - 200000) * 0.03), espp = Math.round((1000000 + variable) * 0.03);
    add({ type: 'payslip', institution: 'Acme UK Ltd', name: `Sample payslip ${MON[s.getUTCMonth()]}`, period: { start: pd, end: pd }, payDate: pd, employer: 'Acme UK Ltd', basic: 1000000, car: 55000, variable,
      grossBeforePension: gross, pensionEmployee: 200000, pensionEmployer: 60000, taxablePay: gross - 200000, tax, ni, espp, rsuWithholding: 0, rsuIncome: 0, otherDeductions: 0,
      net: gross - 200000 - tax - ni - espp, items: [], ytd: {}, ok: true, problems: [], txns: [] });
  }
  add({ type: 'moneyfarm', institution: 'Moneyfarm ISA', name: 'Sample ISA Q2', period: { start: '2026-04-01', end: '2026-06-30' }, start: 6000000, end: 6350000, paidIn: 200000, paidOut: 0, investmentReturn: 150000, fees: -9000, isaAllowanceLeft: 1800000, contributions: [{ date: '2026-05-15', amount: 200000 }], ok: true, problems: [], txns: [] });
  add({ type: 'moneyfarm', institution: 'Moneyfarm ISA', name: 'Sample ISA Q3', period: { start: '2026-07-01', end: '2026-09-30' }, start: 6350000, end: 7300000, paidIn: 800000, paidOut: 0, investmentReturn: 150000, fees: -10000, isaAllowanceLeft: 1000000, contributions: [{ date: '2026-07-15', amount: 800000 }], ok: true, problems: [], txns: [] });
  add({ type: 'aviva', institution: 'Pension', name: 'Sample pension', period: { start: '2025-03-01', end: '2026-02-28' }, start: 15000000, paidIn: 3100000, paidOut: 0, growth: 1900000, charges: 45000, end: 19955000, payments: [], projectedPot: 80000000, projectedIncome: 5000000, retirementDate: '1 March 2045', ok: true, problems: [], txns: [] });
  S.files = files; S.demo = true; S.lastSync = null; rebuild();
  statusLine(); render();
}
