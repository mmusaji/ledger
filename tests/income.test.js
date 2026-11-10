// Payslip, savings and pension reader (readers/income.js): what is the document, and do its own figures prove it? All invented.
// Run: node tests/income.test.js
const path = require('path');
const I = require(path.join(path.resolve(__dirname, '..'), 'readers/income.js'));
let fail = 0, n = 0; const ok = (c, m) => { n++; if (!c) { fail++; console.log('FAIL', m); } };
const L = a => a.map(text => ({ text }));
const rd = a => I.read(L(a));

// ---- payslips in different layouts
const SIMPLE = ['ACME LTD Payslip', 'Pay Date 25/11/2026', 'Description Amount', 'Basic Pay 4,000.00', 'Bonus 500.00', 'Gross Pay 4,500.00', 'Income Tax 700.00', 'National Insurance 300.00', 'Pension (Employee) 200.00', 'Total Deductions 1,200.00', 'Net Pay 3,300.00', 'Year to date', 'Gross Pay 40,000.00', 'Income Tax 6,000.00', 'Net Pay 30,000.00'];
{ const r = rd(SIMPLE); ok(r.kind === 'payslip', 'a payslip is recognised');
  const p = r.result; ok(p.confidence === 'verified' && p.ok && p.net === 330000 && p.gross === 450000 && p.totalDeductions === 120000, 'simple payslip: gross − deductions = net proves it');
  ok(p.payDate === '2026-11-25' && p.tax === 70000 && p.ni === 30000 && p.pensionEmployee === 20000 && p.otherDeductions === 0, 'date and the breakdown are read; year-to-date figures are not mixed in');
  ok(p.grossBeforePension === 450000, 'pension taken as a deduction: gross is already before pension'); }
{ const t = SIMPLE.slice(); t[10] = 'Net Pay 3,400.00'; const p = rd(t).result; ok(p.confidence === 'failed' && !p.ok, 'a net pay changed by £100 is not accepted');
  const t2 = SIMPLE.slice(); t2[9] = 'Total Deductions 1,100.00'; ok(rd(t2).result.confidence === 'failed', 'deductions changed: not accepted'); }
{ // two-column table: earnings left, deductions right, on the same lines
  const t = ['Payslip', 'Payment date: 28 Nov 2026', 'Earnings Deductions', 'Basic Pay 5,000.00 Tax 900.00', 'Commission 250.00 NI 350.00', 'Student Loan 120.00', 'Total Gross Pay 5,250.00 Total Deductions 1,370.00', 'Net Pay 3,880.00'];
  const p = rd(t).result; ok(p.confidence === 'verified' && p.net === 388000 && p.tax === 90000 && p.ni === 35000 && p.studentLoan === 12000 && p.payDate === '2026-11-28', 'two-column layout, date as "28 Nov 2026", student loan found'); }
{ // salary sacrifice: the printed gross is already after the pension
  const t = ['Payslip', 'Pay Date 2026-10-31', 'Total Earnings 3,800.00', 'Pension Salary Sacrifice 200.00', 'Tax 600.00', 'NI 250.00', 'Total Deductions 850.00', 'Net Pay 2,950.00'];
  const p = rd(t).result; ok(p.confidence === 'verified' && p.pensionEmployee === 20000 && p.grossBeforePension === 400000 && p.otherDeductions === 0, 'salary sacrifice: gross before pension is gross + pension'); }
{ const p = rd(['Payslip', 'Pay Date 25/11/2026', 'Net Pay 3,300.00', 'Tax Code 1257L']).result; ok(p.confidence === 'unverified' && p.net === 330000 && !p.ok, 'only net pay found: read but not proven (the app asks you to fill in the rest)'); }
{ const p = rd(['Payslip', 'Gross Pay 4,500.00', 'Total Deductions 1,200.00', 'Net Pay 3,300.00']).result; ok(p.confidence === 'verified' && !p.payDate && p.problems.length === 1, 'proved but no date: flagged so it can be asked for'); }
ok(I.pence('4,500') === null && I.pence('1999') === null, 'a bare number is never money');

// ---- savings and pensions
const ISA = ['Stocks & Shares ISA statement', 'Statement from 1 July 2026 to 30 September 2026', 'Opening value £10,000.00', 'Money paid in £1,000.00', 'Withdrawals £0.00', 'Investment growth £250.00', 'Fees £25.00', 'Closing value £11,225.00', 'Remaining ISA allowance £15,000.00'];
{ const r = rd(ISA); ok(r.kind === 'savings', 'an ISA statement is recognised'); const s = r.result;
  ok(s.confidence === 'verified' && s.start === 1000000 && s.paidIn === 100000 && s.growth === 25000 && s.charges === 2500 && s.end === 1122500, 'ISA: opening + in − out + growth − fees = closing proves it');
  ok(s.kind === 'isa' && s.isaAllowanceLeft === 1500000 && s.period.start === '2026-07-01' && s.period.end === '2026-09-30', 'ISA kind, allowance and period read'); }
{ const t = ISA.slice(); t[7] = 'Closing value £11,325.00'; ok(rd(t).result.confidence === 'failed', 'ISA closing value changed by £100: not accepted');
  const t2 = ISA.slice(); t2[3] = 'Money paid in £900.00'; ok(rd(t2).result.confidence === 'failed', 'ISA paid-in changed: not accepted'); }
{ const s = rd(['Cash ISA statement', 'Statement period 01/04/2026 - 30/06/2026', 'Closing balance £5,100.00']).result; ok(s.confidence === 'unverified' && s.end === 510000, 'only a closing value: read, not proven'); }
{ const t = ['Junior ISA annual statement', 'from 6 April 2025 to 5 April 2026', 'Opening balance £2,000.00', 'Deposits £600.00', 'Interest £40.00', 'Closing balance £2,640.00']; const s = rd(t).result; ok(s.confidence === 'verified' && s.kind === 'jisa', 'a Junior ISA is a Junior ISA, not an ISA'); }
{ // pension: amounts on one line, their labels on the next; the growth and charges amounts under their labels
  const t = ['Aviva workplace pension', 'Statement for 6 April 2025 to 5 April 2026', '£10,000.00 £2,000.00 £0.00 £12,475.00', 'Value of your pension Money paid in Money paid out Value of your pension', 'Your investments have gone up in value by', '£500.00', 'Your plan costs and charges were', '£25.00'];
  const r = rd(t); ok(r.kind === 'pension', 'a pension statement is recognised'); const s = r.result;
  ok(s.confidence === 'verified' && s.start === 1000000 && s.paidIn === 200000 && s.paidOut === 0 && s.end === 1247500 && s.growth === 50000 && s.charges === 2500, 'pension: header row of labels over a row of amounts, proved');
  const t2 = t.slice(); t2[2] = '£10,000.00 £2,000.00 £0.00 £12,575.00'; ok(rd(t2).result.confidence === 'failed', 'pension closing value changed: not accepted');
  const down = t.slice(); down[4] = 'Your investments have gone down in value by'; down[2] = '£10,000.00 £2,000.00 £0.00 £11,475.00'; ok(rd(down).result.confidence === 'verified', 'a fall in value is applied with the right sign'); }
{ const t = ['Pension statement', 'Statement from 1 Jan 2026 to 31 Dec 2026', 'Opening balance £8,000', 'Contributions £1,200', 'Growth £340', 'Charges £40', 'Closing balance £9,500']; const s = rd(t).result; ok(s.confidence === 'verified', 'whole-pound statements allow for rounding'); }

// ---- what is it? and what is not ours
ok(rd(['Sort code 11-22-33', 'Balance brought forward 100.00', 'Money in', 'Money out', 'Current account statement']).kind === 'bank', 'a bank statement is classed as a bank statement, not read here');
ok(rd(['Credit limit £5,000', 'Minimum payment £25.00', 'Payment due 28/11/2026', 'APR 22.9%']).kind === 'card', 'a card statement is classed as a card');
{ const r = rd(['Dear Patient', 'Your appointment is confirmed for 3 March 2026', 'Please arrive ten minutes early']); ok(r.kind === 'unknown' && r.result === null, 'a letter that is not financial is not a document of ours: nothing is read or kept'); }
ok(rd(['Payslip', 'Pension contribution 5%', 'Net Pay 2,000.00', 'Gross Pay 2,500.00', 'Total Deductions 500.00', 'Tax Code 1257L']).kind === 'payslip', 'a payslip that mentions a pension is still a payslip');

console.log(fail ? `${fail} FAILED of ${n}` : `income: all ${n} checks passed`); process.exit(fail ? 1 : 0);
