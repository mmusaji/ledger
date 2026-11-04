/* Pay cycles: which pay month a date falls in (the start day is adjustable in Settings, default the 6th). */
import { MON, isoOf, monthLabel, pad, store } from './util.js';

// Pay cycle: monthly, from payDay of one month to the day before payDay of the next.
// Default 6 = 6th→5th (salary around the 25th). UK tax year (6 Apr) is separate.
const DEFAULT_PAY_DAY = 6;

export function payDay() {
  const d = +store.get('payDay', DEFAULT_PAY_DAY);
  return (Number.isInteger(d) && d >= 1 && d <= 28) ? d : DEFAULT_PAY_DAY;
}

export function cycleOf(iso) {
  const D = payDay();
  let y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
  if (d < D) { m -= 1; if (m === 0) { m = 12; y -= 1; } }
  const start = `${y}-${pad(m)}-${pad(D)}`;
  const e = new Date(Date.UTC(y, m, D - 1)); // month index m = calendar month after start
  return { key: `${y}-${pad(m)}`, start, end: isoOf(e) };
}

export function cycleFromKey(key) { return cycleOf(`${key}-${pad(payDay())}`); }

export const cycleLabel = key => monthLabel(key);

export const cycleShort = key => MON[+key.slice(5) - 1];
