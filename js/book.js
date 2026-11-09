/* The account book and the overlap rules. Pure logic with no page or storage access (tested in Node by tests/book.test.js).
 *
 * book = { accounts: [{ id, name, kind: 'card'|'current', role?, link?, payHint? }],
 *          assign:   { <fileId>: <accountId> },        which account each CSV file belongs to
 *          layouts:  { <layout signature>: <accountId> } the account a CSV layout was last given (so the next one needs no question) }
 * Nothing here changes a saved file: assignments and overlaps are worked out again every time the picture is rebuilt,
 * so changing an answer or undoing an import never needs the original statement again.
 */
export const newBook = () => ({ accounts: [], assign: {}, layouts: {} });

export const bookOf = b => ({ accounts: (b && b.accounts) || [], assign: (b && b.assign) || {}, layouts: (b && b.layouts) || {} });

/** What a CSV layout looks like, so the same bank export can be recognised next time: the column names it was read from
 *  (never the contents) plus whether it is a card or a current account. */
export function layoutSig(r) {
  const c = r.columns || {};
  const names = Object.values(c).flat().map(x => String(x).toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean).sort();
  return (r.accountType || 'unknown') + '|' + names.join('|');
}

export const newId = () => 'acct-' + [...crypto.getRandomValues(new Uint8Array(4))].map(b => b.toString(16).padStart(2, '0')).join('');

/** Words that make a positive card line a payment towards the card rather than a refund. */
export const PAYMENT_LIKE = /payment|thank you|direct debit|repayment|\bdd\b|bacs|faster pay|transfer in|received/i;

// ---------------------------------------------------------------- overlaps
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const within = (d, p) => d >= p.start && d <= p.end;
const keyOf = t => t.date + '|' + t.amount;

/** Several files for one account can cover the same days. Work out which transactions count.
 *    sources: [{ id, kind: 'pdf'|'csv', gkey, rank, period, txns }]   rank: 3 statement PDF that adds up, 2 CSV proven by its balance,
 *                                                                     1 CSV with nothing to check it against, 0 PDF that did not add up
 *  Rules, per account (gkey):
 *    - only overlaps that involve a CSV (or a PDF read by the generic reader, which is shaped like one) are judged here.
 *      Two bank PDFs of one account are left to the rules that already handle them (Monzo: the later statement wins).
 *    - a source that ranks higher wins. A PDF that adds up is the whole statement for its dates, so lower sources lose
 *      everything dated inside it. A checked source (rank 2 or more) likewise replaces a PDF that did not add up.
 *    - otherwise the same date and amount counted once: each row of the higher source "uses up" one matching row of
 *      the lower one (a multiset, so two identical coffees on one day stay two).
 *    - rows of the lower source that fall inside the higher source's dates but match nothing are KEPT and counted as
 *      "differs", never silently dropped.
 *  Returns { drop: Map(id -> Set(txn index)), report: Map(id -> { dup, kept, differs, overlapWith: [names] }) } */
export function planOverlaps(sources) {
  const drop = new Map(), report = new Map();
  const groups = {}; sources.forEach(s => { (groups[s.gkey] = groups[s.gkey] || []).push(s); });
  Object.values(groups).forEach(list => {
    if (list.length < 2) return;
    const order = list.slice().sort((a, b) => (b.rank - a.rank) || a.period.start.localeCompare(b.period.start) || String(a.id).localeCompare(String(b.id)));
    order.forEach((s, i) => {
      const higher = order.slice(0, i).filter(h => h.period.start <= s.period.end && h.period.end >= s.period.start && !(h.kind === 'pdf' && s.kind === 'pdf'));
      if (!higher.length) return;
      // a higher source that takes every row dated inside it, matched or not
      const whole = h => (h.kind === 'pdf' && h.rank === 3) || (h.rank >= 2 && s.kind === 'pdf' && s.rank === 0);
      const d = new Set(); let dup = 0, kept = 0, differs = 0;
      const pool = new Map();
      higher.filter(h => !whole(h)).forEach(h => h.txns.forEach(t => { if (within(t.date, s.period)) pool.set(keyOf(t), (pool.get(keyOf(t)) || 0) + 1); }));
      s.txns.forEach((t, ix) => {
        if (higher.some(h => whole(h) && within(t.date, h.period))) { d.add(ix); dup++; return; }
        const inside = higher.some(h => within(t.date, h.period));
        if (!inside) { kept++; return; }
        const k = keyOf(t), c = pool.get(k) || 0;
        if (c > 0) { pool.set(k, c - 1); d.add(ix); dup++; } else { differs++; kept++; }
      });
      if (d.size) drop.set(s.id, d);
      report.set(s.id, { dup, kept, differs, overlapWith: higher.map(h => h.name || h.id) });
    });
  });
  return { drop, report };
}

/** Gaps and broken balance carry-overs between the statements of one account (CSV and PDF together).
 *  Returns [{ gkey, text }]. A gap is more than 3 days with nothing covering it. */
export function continuity(sources, nameOf = x => x) {
  const out = [];
  const groups = {}; sources.forEach(s => { (groups[s.gkey] = groups[s.gkey] || []).push(s); });
  Object.entries(groups).forEach(([gkey, list]) => {
    if (!list.some(s => s.kind === 'csv')) return;
    const sorted = list.slice().sort((a, b) => a.period.start.localeCompare(b.period.start));
    let reach = sorted[0].period.end;
    for (let i = 1; i < sorted.length; i++) {
      const s = sorted[i];
      if (daysBetween(reach, s.period.start) > 3) out.push({ gkey, text: `${nameOf(gkey)}: nothing covers ${addDays(reach, 1)} to ${addDays(s.period.start, -1)}` });
      if (s.period.end > reach) reach = s.period.end;
    }
    // balance carry-over between consecutive CSV files that both have balances and do not overlap
    const csv = sorted.filter(s => s.kind === 'csv' && s.txns.some(t => t.balance != null));
    for (let i = 1; i < csv.length; i++) {
      const a = csv[i - 1], b = csv[i]; if (b.period.start <= a.period.end) continue;
      // only judged when the edge day has a single row, because the order of rows within a day is not reliable
      const edge = (s, last) => { const ds = s.txns.filter(t => t.balance != null).map(t => t.date).sort(); const d = last ? ds[ds.length - 1] : ds[0]; const rows = s.txns.filter(t => t.date === d && t.balance != null); return rows.length === 1 ? rows[0] : null; };
      const lastA = edge(a, true), firstB = edge(b, false);
      if (lastA && firstB && lastA.balance !== firstB.balance - firstB.amount) out.push({ gkey, text: `${nameOf(gkey)}: the balance does not carry over between ${a.period.end} and ${b.period.start}` });
    }
  });
  return out;
}

// ---------------------------------------------------------------- answers from the naming sheet
/** Apply one answer from the naming sheet to a book (mutates it). Returns the account the files now belong to and,
 *  when the answer made a new account, that account (so an import can be undone).
 *    { mode: 'existing', accountId }
 *    { mode: 'link', link: { gkey, accId, label, txnType, kind }, name }   the same account as one known from PDF statements
 *    { mode: 'new', name, kind: 'card'|'current', role?, payHint? } */
export function applyChoice(book, c) {
  if (c.mode === 'existing') return { accountId: c.accountId, created: null };
  if (c.mode === 'link') {
    const have = book.accounts.find(a => a.link && a.link.gkey === c.link.gkey);
    if (have) return { accountId: have.id, created: null };
    const a = { id: newId(), name: c.name, kind: c.link.kind, link: c.link };
    book.accounts.push(a); return { accountId: a.id, created: a };
  }
  const a = { id: newId(), name: String(c.name).trim(), kind: c.kind };
  if (c.kind === 'current') a.role = c.role === 'personal' ? 'personal' : 'household'; else a.payHint = String(c.payHint || '').trim();
  book.accounts.push(a); return { accountId: a.id, created: a };
}

/** Words the bank statement is likely to use for payments to a card, to pre-fill the question. */
export function suggestPayHint(name) {
  const n = String(name || '').toLowerCase();
  if (/amex|american express/.test(n)) return 'AMERICAN EXP|AMEX';
  if (/tesco/.test(n)) return 'TESCO BANK|TESCO CREDIT';
  const first = n.split(/[^a-z0-9]+/).filter(x => x.length >= 3)[0];
  return first ? first.toUpperCase() : '';
}
