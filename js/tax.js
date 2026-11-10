/* A take-home pay ESTIMATE for typing a payslip in by hand (England, Wales and Northern Ireland; standard tax code 1257L).
 * Pure arithmetic with no page or storage access (tested in Node by tests/tax.test.js). Money is whole pence.
 * It is an estimate, never shown as a payslip fact: real payslips differ by a few pounds (tax code, rounding, other deductions),
 * so the app offers to correct it from the matching bank deposit. Tax years before 2023/24 are not built in and return null.
 * Rates (frozen thresholds): personal allowance £12,570, reduced by £1 for every £2 over £100,000; 20% on the next £37,700; 40% up to
 * £125,140 of income; 45% above. Employee National Insurance between £1,048 and £4,189 a month: 12% until 5 Jan 2024, 10% to 5 Apr 2024,
 * 8% since, and 2% above the upper limit.
 */
const PA = 1257000, BASIC_BAND = 3770000, TAPER_FROM = 10000000, ADD_FROM = 12514000;
const NI_PT = 104800, NI_UEL = 418900; // per month
const NI_MAIN = [['2024-04-06', 0.08], ['2024-01-06', 0.10], ['2023-04-06', 0.12]]; // newest first
const FIRST = '2023-04-06';

export const taxYearOf = date => (date.slice(5) >= '04-06' ? +date.slice(0, 4) : +date.slice(0, 4) - 1);
export const supported = date => date >= FIRST;

/** Income tax for a whole year on this much taxable pay (after any pension taken before tax). */
export function annualTax(taxable) {
  const pa = Math.max(0, PA - Math.max(0, Math.floor((taxable - TAPER_FROM) / 2)));
  const ti = Math.max(0, taxable - pa);
  const basic = Math.min(ti, BASIC_BAND);
  const higher = Math.max(0, Math.min(taxable, ADD_FROM) - pa - BASIC_BAND);
  const add = Math.max(0, taxable - ADD_FROM);
  return Math.round(basic * 0.2 + Math.max(0, higher) * 0.4 + add * 0.45);
}
/** Employee National Insurance for one month on this much pay. */
export function monthlyNI(pay, date) {
  const rate = (NI_MAIN.find(([from]) => date >= from) || [])[1]; if (rate === undefined) return null;
  return Math.round(Math.max(0, Math.min(pay, NI_UEL) - NI_PT) * rate + Math.max(0, pay - NI_UEL) * 0.02);
}

/** Estimate one month's pay.
 *    date           the pay date, yyyy-mm-dd (decides the tax year and the NI rate)
 *    salary         annual pay before tax and pension, in pence (the base the pension % is taken from)
 *    pensionPct     your pension contribution as a percentage of that salary (0 for none)
 *    pensionMode    'sacrifice' (taken before tax and NI; the usual workplace scheme), 'netpay' (before tax only), 'ras' (taken after tax, tax relief added to the pension)
 *    otherMonthly   any other fixed monthly deductions, in pence (health cover, student loan, share plan ...)
 *  Returns { gross, pension, taxable, tax, ni, other, net, estimate: true } or null for a date this does not cover. */
export function estimateMonth({ date, salary, pensionPct = 0, pensionMode = 'sacrifice', otherMonthly = 0 }) {
  if (!supported(date) || !(salary > 0)) return null;
  const gross = Math.round(salary / 12);
  const pension = Math.round(gross * pensionPct / 100);
  const before = pensionMode === 'sacrifice' || pensionMode === 'netpay';
  const taxable = before ? gross - pension : gross;
  const niPay = pensionMode === 'sacrifice' ? gross - pension : gross;
  const tax = Math.round(annualTax(taxable * 12) / 12), ni = monthlyNI(niPay, date);
  if (ni === null) return null;
  // relief at source: the scheme claims 20% back, so you pay only 80% of the contribution out of net pay
  const pensionCost = pensionMode === 'ras' ? Math.round(pension * 0.8) : pension;
  const net = gross - pensionCost - tax - ni - otherMonthly;
  return { gross, pension, taxable, tax, ni, other: otherMonthly, net, estimate: true };
}
