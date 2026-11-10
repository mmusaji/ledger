// UK take-home estimate (js/tax.js). The expected figures are worked out by hand from the published rates. Run: node tests/tax.test.js
const path = require('path');
let fail = 0, n = 0; const ok = (c, m) => { n++; if (!c) { fail++; console.log('FAIL', m); } };
(async () => {
  const T = await import(path.join(path.resolve(__dirname, '..'), 'js/tax.js'));
  const e = (o) => T.estimateMonth(Object.assign({ date: '2026-11-25' }, o));
  { const r = e({ salary: 5000000, pensionPct: 5 });   // £50,000, 5% before tax and NI
    ok(r.gross === 416667 && r.pension === 20833 && r.taxable === 395834, '£50,000 with 5% pension: gross, pension, taxable pay per month');
    ok(r.tax === 58217 && r.ni === 23283 && r.net === 314334, '£50,000 with 5% pension: tax £582.17, NI £232.83, take-home £3,143.34'); }
  { const r = e({ salary: 3000000 }); ok(r.tax === 29050 && r.ni === 11616 && r.net === 209334, '£30,000, no pension: tax £290.50, NI £116.16, take-home £2,093.34'); }
  { const r = e({ salary: 12000000 }); ok(r.tax === 328600 && r.ni === 36750 && r.net === 634650, '£120,000: personal allowance tapered to £2,570; tax £3,286, NI £367.50'); }
  { const r = e({ salary: 5000000, pensionPct: 5, pensionMode: 'netpay' }); ok(r.tax === 58217 && r.ni === 24949, 'pension before tax only: NI is on the full pay'); }
  { const r = e({ salary: 5000000, pensionPct: 5, pensionMode: 'ras' }); ok(r.taxable === r.gross && r.net === r.gross - Math.round(20833 * 0.8) - r.tax - r.ni, 'relief at source: tax on full pay, you pay 80% of the pension from net'); }
  ok(e({ salary: 1200000 }).tax === 0, 'below the personal allowance: no tax');
  ok(e({ salary: 5000000, otherMonthly: 5000 }).net === e({ salary: 5000000 }).net - 5000, 'other fixed deductions come off the take-home');
  // the NI rate follows the pay date; years before 2023/24 are not built in
  ok(T.monthlyNI(400000, '2023-11-30') === Math.round((400000 - 104800) * 0.12), 'NI 12% before 6 Jan 2024');
  ok(T.monthlyNI(400000, '2024-02-29') === Math.round((400000 - 104800) * 0.10), 'NI 10% from 6 Jan 2024');
  ok(T.monthlyNI(400000, '2024-04-30') === Math.round((400000 - 104800) * 0.08), 'NI 8% from 6 Apr 2024');
  ok(e({ salary: 5000000, date: '2023-03-31' }) === null, 'before 2023/24: not estimated (the app asks for the figures instead)');
  ok(T.taxYearOf('2026-04-05') === 2025 && T.taxYearOf('2026-04-06') === 2026, 'tax year runs 6 April to 5 April');
  ok(e({ salary: 5000000 }).estimate === true, 'results are flagged as estimates');
  console.log(fail ? `${fail} FAILED of ${n}` : `tax: all ${n} checks passed`); process.exit(fail ? 1 : 0);
})().catch(x => { console.log('CRASH', x); process.exit(1); });
