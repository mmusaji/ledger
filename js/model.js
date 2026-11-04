/* Building the picture from the saved statements: transactions, categories, card-repayment matching and date ranges. */
import { GROUP_OF, categorise } from './deps.js';
import { cycleFromKey, cycleLabel, cycleOf } from './period.js';
import { S } from './state.js';
import { ONE_OFF, baseKey, daysBetween, keyOf, niceShort } from './util.js';

const MONEY_TYPES = ['santander', 'amex', 'tesco'];

export function rebuild(extraSkipped = []) {
  const entries = Object.entries(S.files).map(([id, e]) => Object.assign({ id }, e));
  const read = [], skipped = [];
  entries.forEach(e => {
    const r = e.result;
    if (r && r.period && r.type && r.type !== 'unsupported' && r.type !== 'unreadable') read.push(e);
    else skipped.push({ id: e.id, name: e.name, why: e.skipped || (r && r.problems && r.problems[0]) || 'Not read', type: r && r.type });
  });
  // The same statement saved twice (e.g. "tescobank (3).pdf" and "(4)") is only counted once.
  read.sort((a, b) => (b.result.ok - a.result.ok) || a.name.localeCompare(b.name));
  const seen = new Map(), kept = [];
  read.forEach(e => {
    const r = e.result; const k = [r.type, (r.holders || []).join(','), r.period.start, r.period.end].join('|');
    if (seen.has(k)) skipped.push({ id: e.id, name: e.name, why: 'Duplicate of ' + seen.get(k), dup: true });
    else { seen.set(k, e.name); kept.push(e); }
  });
  S.statements = kept.map(e => {
    const r = e.result;
    return { id: e.id, name: e.name, type: r.type, institution: r.institution, period: r.period, ok: r.ok, problems: r.problems || [],
      count: (r.txns || []).length, opening: r.opening, closing: r.closing, summary: r.summary, holders: r.holders };
  }).sort((a, b) => a.period.end.localeCompare(b.period.end));
  const txns = [];
  kept.filter(e => MONEY_TYPES.includes(e.result.type)).forEach(e => {
    const n = {};
    (e.result.txns || []).forEach(t0 => {
      const t = Object.assign({}, t0, { source: e.name, stmtType: e.result.type });
      if (t.balance === undefined) t.balance = null;
      if (!t.account) t.account = 'Joint account';
      if (!t.type) t.type = e.result.type === 'santander' ? 'bank' : 'card';
      if (!t.payee) t.payee = t.desc.slice(0, 30);
      const b = baseKey(t); n[b] = (n[b] || 0) + 1; t.key = n[b] > 1 ? b + '.' + n[b] : b;
      t.cycle = cycleOf(t.date).key;
      txns.push(t);
    });
  });
  txns.sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'bank' && b.type === 'bank' ? 0 : 0));
  S.txns = txns;
  S.payslips = kept.filter(e => e.result.type === 'payslip').map(e => Object.assign({ name: e.name }, e.result)).sort((a, b) => a.payDate.localeCompare(b.payDate));
  S.isa = kept.filter(e => e.result.type === 'moneyfarm').map(e => Object.assign({ name: e.name }, e.result)).sort((a, b) => a.period.end.localeCompare(b.period.end));
  S.pension = kept.filter(e => e.result.type === 'aviva').map(e => Object.assign({ name: e.name }, e.result)).sort((a, b) => a.period.end.localeCompare(b.period.end));
  S.skipped = skipped.concat(extraSkipped);
  recategorise();
}

/** Categorise everything and stop card repayments being counted twice. */
export function recategorise() {
  const cardStmts = S.statements.filter(s => s.type === 'amex' || s.type === 'tesco');
  S.txns.forEach(t => {
    t.match = null; t.repayStatus = null;
    if (t.kind === 'Card repayment received') { t.category = 'Card repayment (card side)'; t.group = 'internal'; t.catBy = 'card statement'; return; }
    const c = categorise(t, S.rules, S.overrides, keyOf);
    t.category = c.category; t.group = GROUP_OF[c.category]; t.catBy = c.by; t.catRule = c.rule;
    if (t.group === 'cards' && t.type === 'bank' && t.amount < 0) {
      const inst = /AMERICAN EXP|AMEX/i.test(t.desc) ? 'amex' : /TESCO BANK/i.test(t.desc) ? 'tesco' : null;
      const pool = cardStmts.filter(s => s.type === inst);
      const m = pool.find(s => s.summary && (s.summary.closing === -t.amount) && t.date >= s.period.end && daysBetween(s.period.end, t.date) <= 40);
      const covered = pool.some(s => s.period.end <= t.date && daysBetween(s.period.end, t.date) <= 40); // the statement it pays off is loaded
      if (m) { t.match = m.name; t.repayStatus = 'matched'; t.group = 'paidcard'; }
      else if (covered) { t.repayStatus = 'covered'; t.group = 'paidcard'; }
      else t.repayStatus = 'nocard';
    }
  });
}

export const isSpend = t => t.group === 'spend' || t.group === 'cards';

export const oneOff = t => isSpend(t) && -t.amount >= ONE_OFF;

function cycles() { return [...new Set(S.txns.filter(t => t.type === 'bank').map(t => t.cycle))].sort(); }

/** Pay months the bank statements cover from start to finish. If your pay month starts on a different day to the
 *  statements (say the 26th, with statements running 6th to 5th), the first and last pay month are only part covered:
 *  they would show a few days of spending and no salary. Those are left out of the totals and reported in `part`
 *  so the screen can say so. A few days of slack keeps statements that are a day or two out of step with the pay
 *  month counting as covered. */
function coveredCycles() {
  const all = cycles();
  const bank = S.statements.filter(s => s.type === 'santander');
  if (!all.length || !bank.length) return { keys: all, part: [] };
  const first = bank.map(s => s.period.start).sort()[0];
  const last = bank.map(s => s.period.end).sort().pop();
  const SLACK = 3;
  const keys = [], part = [];
  all.forEach(k => {
    const c = cycleFromKey(k);
    if (daysBetween(first, c.start) >= -SLACK && daysBetween(c.end, last) >= -SLACK) keys.push(k);
    else part.push({ key: k, from: c.start > first ? c.start : first, to: c.end < last ? c.end : last, start: c.start, end: c.end });
  });
  return keys.length ? { keys, part } : { keys: all, part: [] }; // never hide everything
}

export function rangeFor(p) {
  const { keys: cs, part } = coveredCycles(); if (!cs.length) return null;
  const lastKey = cs[cs.length - 1]; const last = cycleFromKey(lastKey);
  const r = rangeForCycles(p, cs, lastKey, last);
  if (r) r.part = part;
  return r;
}

function rangeForCycles(p, cs, lastKey, last) {
  if (p === 'latest') return { from: last.start, to: last.end, keys: [lastKey], label: `Pay month ${cycleLabel(lastKey)} · ${niceShort(last.start)} – ${niceShort(last.end)}` };
  if (p === 'all') return { from: cycleFromKey(cs[0]).start, to: last.end, keys: cs, label: `All ${cs.length} pay months` };
  if (p === 'tax') {
    // UK tax year always starts 6 April; independent of pay-cycle start day.
    const y = +last.end.slice(0, 4); const sy = last.end.slice(5) >= '04-06' ? y : y - 1;
    const keys = cs.filter(k => cycleFromKey(k).start >= `${sy}-04-06`);
    return { from: `${sy}-04-06`, to: last.end, keys, label: `Tax year ${sy}/${String(sy + 1).slice(2)} so far` };
  }
  const keys = cs.slice(-(+p));
  return { from: cycleFromKey(keys[0]).start, to: last.end, keys, label: `Last ${keys.length} pay month${keys.length > 1 ? 's' : ''} · ${cycleLabel(keys[0])} – ${cycleLabel(lastKey)}` };
}

export const inRange = (t, r) => t.date >= r.from && t.date <= r.to;
