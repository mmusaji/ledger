/* Building the picture from the saved statements: transactions, categories, card-repayment matching and date ranges. */
import { GROUP_OF, categorise } from './deps.js';
import { cycleFromKey, cycleLabel, cycleOf } from './period.js';
import { S } from './state.js';
import { ONE_OFF, baseKey, daysBetween, keyOf, niceShort, store } from './util.js';

const MONEY_TYPES = ['santander', 'amex', 'tesco', 'monzo'];

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
    const r = e.result; const k = [r.type, (r.account && r.account.id) || '', (r.holders || []).join(','), r.period.start, r.period.end].join('|');
    if (seen.has(k)) skipped.push({ id: e.id, name: e.name, why: 'Duplicate of ' + seen.get(k), dup: true });
    else { seen.set(k, e.name); kept.push(e); }
  });
  S.statements = kept.map(e => {
    const r = e.result;
    return { id: e.id, name: e.name, type: r.type, institution: r.institution, period: r.period, ok: r.ok, problems: r.problems || [],
      count: (r.txns || []).length, opening: r.opening, closing: r.closing, summary: r.summary, holders: r.holders, pots: r.pots, account: r.account };
  }).sort((a, b) => a.period.end.localeCompare(b.period.end));
  const txns = [];
  // Monzo statements cover whatever dates you chose, so two can overlap. A line that falls inside a statement that
  // ranks ahead of this one (later end date) is counted once, from that statement.
  const monzoAhead = e => kept.filter(o => o !== e && o.result.type === 'monzo' && accIdOf(o.result) === accIdOf(e.result) && (o.result.period.end > e.result.period.end || (o.result.period.end === e.result.period.end && o.name < e.name)));
  kept.filter(e => MONEY_TYPES.includes(e.result.type)).forEach(e => {
    const n = {};
    const ahead = e.result.type === 'monzo' ? monzoAhead(e) : [];
    (e.result.txns || []).filter(t0 => !ahead.some(o => t0.date >= o.result.period.start && t0.date <= o.result.period.end)).forEach(t0 => {
      const t = Object.assign({}, t0, { source: e.name, stmtType: e.result.type });
      if (t.balance === undefined) t.balance = null;
      if (!t.account) t.account = 'Joint account';
      if (!t.accId && (t.type === 'bank' || t.type === 'monzo' || e.result.type === 'santander')) t.accId = (e.result.account && e.result.account.id) || e.result.type;
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
  resolveAccounts();
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
  ownAccounts();
}

/** Accounts, roles and views.
 *  Every current account (Santander, Monzo …) is either Household or Personal. All Household accounts are merged
 *  into one household view. A Personal account is its own view and never adds into the household figures.
 *  Credit cards always belong to the household. */
export const isCurrent = t => t.type === 'bank' || t.type === 'monzo';
export const accIdOf = s => (s.account && s.account.id) || s.type; // statements saved before accounts were identified
const roleOf = id => { const a = (S.accountList || []).find(x => x.id === id); return a ? a.role : undefined; };
export const inHousehold = t => !isCurrent(t) || roleOf(t.accId) === 'household';
export const personalAccounts = () => (S.accountList || []).filter(a => a.role === 'personal');
export const hasPersonal = () => personalAccounts().length > 0;
export const pendingAccounts = () => (S.accountList || []).filter(a => !a.role);
export const activeScope = () => (S.scope !== 'household' && personalAccounts().some(a => a.id === S.scope) ? S.scope : 'household');
export const scopeTxns = () => { const sc = activeScope(); return sc === 'household' ? S.txns.filter(inHousehold) : S.txns.filter(t => t.accId === sc); };
export const householdTxns = () => S.txns.filter(inHousehold);
/** Statements of current accounts that belong to the view being shown. */
export const scopeStatements = () => { const sc = activeScope(); return S.statements.filter(s => (s.type === 'santander' || s.type === 'monzo') && (sc === 'household' ? roleOf(accIdOf(s)) === 'household' : accIdOf(s) === sc)); };
export const accountName = a => a.bank + (a.holder ? ' · ' + a.holder : a.last4 ? ' ····' + a.last4 : '');

/** Work out which accounts the statements belong to and which of them have been given a role. The first account
 *  ever added is the household's by definition. Later ones wait (and are left out of every figure) until you say
 *  whether they are Household or Personal. */
function resolveAccounts() {
  const seen = new Map();
  S.statements.filter(s => s.type === 'santander' || s.type === 'monzo').forEach(s => {
    const id = accIdOf(s);
    if (!seen.has(id)) seen.set(id, { id, bank: s.institution || (s.type === 'monzo' ? 'Monzo' : 'Santander'), last4: (s.account && s.account.last4) || '', type: s.type, holder: (s.holders || [])[0] || '' });
  });
  const list = [...seen.values()];
  list.forEach(a => { a.role = S.accounts[a.id] && S.accounts[a.id].role; });
  if (list.length === 1 && !list[0].role && !Object.values(S.accounts).some(c => c.role === 'household')) {
    list[0].role = 'household'; S.accounts[list[0].id] = { role: 'household' };
    if (!S.demo) store.set('accounts', S.accounts);
  }
  S.accountList = list;
}

/** Pots, money moving between household accounts, and money moving between a personal account and the household.
 *  Anything you categorised yourself is left alone. */
function ownAccounts() {
  const free = t => t.catBy !== 'you';
  S.txns.forEach(t => { if (t.pot && free(t)) { t.category = 'Moved to pots'; t.group = 'transfer'; t.catBy = 'pot'; } });
  // a payment leaving one household account and arriving in another is just money moving
  const NOT_TRANSFER = ['Card purchase', 'Direct debit', 'Standing order', 'Cash', 'Card payment', 'Card'];
  const hh = S.txns.filter(t => isCurrent(t) && inHousehold(t) && !t.pot && !NOT_TRANSFER.includes(t.kind));
  if (new Set(hh.map(t => t.accId)).size > 1) {
    const taken = new Set();
    hh.forEach(t => {
      if (taken.has(t) || t.amount >= 0) return;
      let best = null;
      hh.forEach(u => {
        if (taken.has(u) || u === t || u.accId === t.accId || u.amount !== -t.amount) return;
        const d = Math.abs(daysBetween(u.date, t.date)); if (d <= 3 && (!best || d < best.d)) best = { u, d };
      });
      if (!best) return;
      taken.add(t); taken.add(best.u); t.pair = best.u.key; best.u.pair = t.key;
      [t, best.u].forEach(x => { if (free(x)) { x.category = 'Transfers'; x.group = 'transfer'; x.catBy = 'matched transfer'; } });
    });
  }
  // in a personal account, payments to and from the account holder's own name are the household account
  S.txns.filter(t => t.type === 'monzo' && roleOf(t.accId) === 'personal' && t.self && free(t)).forEach(t => {
    t.category = t.amount > 0 ? 'From household account' : 'To household account'; t.group = t.amount > 0 ? 'income' : 'spend'; t.catBy = 'own account';
  });
}

/** Running balance of the combined household account: after each line, the latest balance of every account added together.
 *  With one account this is exactly the balance printed on each line. */
export function balanceSeries(cur) {
  const bal = {}, out = [];
  cur.forEach(t => { if (!(t.accId in bal)) bal[t.accId] = t.balance - t.amount; });
  cur.forEach(t => { bal[t.accId] = t.balance; out.push({ date: t.date, v: Object.values(bal).reduce((s, x) => s + x, 0), t }); });
  return out;
}

export const isSpend = t => t.group === 'spend' || t.group === 'cards';

export const oneOff = t => isSpend(t) && -t.amount >= ONE_OFF;

function cycles() { return [...new Set(scopeTxns().filter(isCurrent).map(t => t.cycle))].sort(); }

/** Pay months the bank statements cover from start to finish. If your pay month starts on a different day to the
 *  statements (say the 26th, with statements running 6th to 5th), the first and last pay month are only part covered:
 *  they would show a few days of spending and no salary. Those are left out of the totals and reported in `part`
 *  so the screen can say so. A few days of slack keeps statements that are a day or two out of step with the pay
 *  month counting as covered. */
function coveredCycles() {
  const all = cycles();
  const bank = scopeStatements();
  if (!all.length || !bank.length) return { keys: all, part: [] };
  // with several accounts, the pay month has to be covered by every one of them
  const per = {}; bank.forEach(s => { const id = accIdOf(s); (per[id] = per[id] || []).push(s); });
  const first = Object.values(per).map(l => l.map(s => s.period.start).sort()[0]).sort().pop();
  const last = Object.values(per).map(l => l.map(s => s.period.end).sort().pop()).sort()[0];
  const SLACK = 3;
  const keys = [], part = [], outside = [];
  all.forEach(k => {
    const c = cycleFromKey(k);
    if (daysBetween(first, c.start) >= -SLACK && daysBetween(c.end, last) >= -SLACK) keys.push(k);
    else if (c.end < first || c.start > last) outside.push(k); // none of it is covered by every account
    else part.push({ key: k, from: c.start > first ? c.start : first, to: c.end < last ? c.end : last, start: c.start, end: c.end });
  });
  return keys.length ? { keys, part, outside } : { keys: all, part: [], outside: [] }; // never hide everything
}

export function rangeFor(p) {
  const { keys: cs, part, outside } = coveredCycles(); if (!cs.length) return null;
  const lastKey = cs[cs.length - 1]; const last = cycleFromKey(lastKey);
  const r = rangeForCycles(p, cs, lastKey, last);
  if (r) { r.part = part; r.outside = outside || []; }
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
