/* Santander current-account statement parser.
 * Runs entirely on the device. Input: the PDF bytes (ArrayBuffer) already in memory.
 * Every transaction is checked against the running balance printed on the statement,
 * so a row is only accepted if amount and balance agree to the penny.
 */
(function (root) {
  'use strict';

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const MONEY_RE = /^-?£?\d{1,3}(?:,\d{3})*\.\d{2}$/;
  const DAY_RE = /^(\d{1,2})(st|nd|rd|th)$/i;
  const MON_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?$/i;

  // Lines that repeat on every page and must never become part of a description.
  const NOISE = [
    /^Account name:/i, /^Page number:/i, /^Date Description Money in Money out/i,
    /^Your transactions/i, /^Continued on reverse/i, /^Statement number/i,
    /^Account number:/i, /Santander UK plc\. Registered Office/i
  ];

  function money(tok) { return Math.round(parseFloat(tok.replace(/[£,]/g, '')) * 100); }
  function pad(n) { return String(n).padStart(2, '0'); }

  /** Group pdf.js text items into rows (top to bottom, left to right). */
  function toLines(pages) {
    const lines = [];
    pages.forEach((items, p) => {
      const rows = [];
      items.filter(i => i.str && i.str.trim()).forEach(i => {
        let row = rows.find(r => Math.abs(r.y - i.y) < 2.5);
        if (!row) { row = { y: i.y, items: [] }; rows.push(row); }
        row.items.push(i);
      });
      rows.sort((a, b) => b.y - a.y);
      rows.forEach(r => {
        r.items.sort((a, b) => a.x - b.x);
        lines.push({ page: p + 1, text: r.items.map(i => i.str.trim()).join(' ').replace(/\s+/g, ' ').trim() });
      });
    });
    return lines;
  }


  /** One line per transaction: date, then the description lines nearest to it, then its amounts. */
  function anchoredLines(pages) {
    const out = [];
    const DATE = /^\d{1,2}(st|nd|rd|th) [A-Za-z]{3}$/;
    const AMOUNT = /^-?£?[\d,]+\.\d{2}$/;
    const HEAD = /^(Date|Description|Money in|Money out|£ ?Balance|Balance)$/;
    pages.forEach(items => {
      const its = items.filter(i => i.str && i.str.trim());
      const anchors = its.filter(i => i.x < 100 && DATE.test(i.str.trim())).map(i => ({ y: i.y, date: i.str.trim(), parts: [] }));
      if (!anchors.length) return;
      const dateX = Math.max(...its.filter(i => i.x < 100 && DATE.test(i.str.trim())).map(i => i.x));
      its.forEach(i => {
        if (i.x < dateX + 25) return;
        const s = i.str.trim(); if (HEAD.test(s)) return;
        let best = null, bd = 1e9;
        anchors.forEach(a => { const d = Math.abs(a.y - i.y); if (d < bd) { bd = d; best = a; } });
        if (best && bd <= 13) best.parts.push(i);
      });
      anchors.sort((a, b) => b.y - a.y).forEach(a => {
        const nums = a.parts.filter(p => p.x > 300 && AMOUNT.test(p.str.trim())).sort((p, q) => p.x - q.x);
        const desc = a.parts.filter(p => !nums.includes(p)).sort((p, q) => (q.y - p.y) || (p.x - q.x));
        out.push([a.date].concat(desc.map(p => p.str.trim()), nums.map(p => p.str.trim())).join(' ').replace(/\s+/g, ' '));
      });
    });
    return out;
  }

  /** Extract positioned text from a PDF held in memory. */
  async function extractPages(pdfjsLib, bytes) {
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      pages.push(tc.items.map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5] })));
    }
    await doc.destroy();
    return pages;
  }

  function findPeriod(all) {
    const m = all.match(/summary for (\d{1,2})(?:st|nd|rd|th)? (\w{3})\w* (\d{4}) to (\d{1,2})(?:st|nd|rd|th)? (\w{3})\w* (\d{4})/i);
    if (!m) return null;
    const start = new Date(Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1]));
    const end = new Date(Date.UTC(+m[6], MONTHS[m[5].toLowerCase()], +m[4]));
    return { start, end };
  }

  function findTotal(all, re) { const m = all.match(re); return m ? money(m[1]) : null; }

  /** Which year does "8th Aug" belong to, given the statement period? */
  function dateFor(day, mon, period) {
    const mi = MONTHS[mon.slice(0, 3).toLowerCase()];
    for (const y of [period.end.getUTCFullYear(), period.start.getUTCFullYear()]) {
      const d = new Date(Date.UTC(y, mi, day));
      if (d >= new Date(period.start.getTime() - 2 * 864e5) && d <= new Date(period.end.getTime() + 2 * 864e5)) return d;
    }
    return new Date(Date.UTC(period.end.getUTCFullYear(), mi, day));
  }

  function iso(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }

  /** How the money moved, from the start of the description. */
  function kindOf(desc) {
    const d = desc.toUpperCase();
    if (d.startsWith('DIRECT DEBIT')) return 'Direct debit';
    if (d.startsWith('STANDING ORDER')) return 'Standing order';
    if (d.startsWith('REGULAR TRANSFER')) return 'Standing order';
    if (d.startsWith('CARD PAYMENT')) return 'Card payment';
    if (d.startsWith('CASH WITHDRAWAL')) return 'Cash';
    if (d.startsWith('TRANSFER')) return 'Transfer';
    if (d.startsWith('BANK GIRO CREDIT')) return 'Bank credit';
    if (d.startsWith('FASTER PAYMENTS RECEIPT')) return 'Payment in';
    if (d.startsWith('BILL PAYMENT') || d.startsWith('THIRD PARTY PAYMENT')) return 'Payment out';
    if (d.includes('MONTHLY FEE') || d.includes('CASHBACK') || d.includes('INTEREST')) return 'Bank charge/credit';
    return 'Other';
  }

  /** A short, readable name for who the money went to or came from. */
  function payeeOf(desc) {
    const pats = [
      /DIRECT DEBIT PAYMENT TO (.+?) REF\b/i,
      /STANDING ORDER VIA FASTER PAYMENT TO (.+?) REFERENCE/i,
      /BILL PAYMENT VIA FASTER PAYMENT TO (.+?) REFERENCE/i,
      /BILL PAYMENT TO (.+?) REFERENCE/i,
      /Third party payment made via Faster Payment to (.+?) Reference/i,
      /CARD PAYMENT TO (.+?) ON \d/i,
      /FASTER PAYMENTS RECEIPT REF\..* FROM (.+)$/,
      /BANK GIRO CREDIT REF (.+?)(?:,|$)/i,
      /TRANSFER (?:FROM|TO) (?:\d\/)?(.+?)(?: \d\/| REF:|$)/i,
      /CASH WITHDRAWAL AT (.+?) ATM/i,
      /REGULAR TRANSFER PAYMENT TO (ACCOUNT \w+ ?\w*)/i
    ];
    if (/CASHBACK/i.test(desc)) return 'Santander cashback';
    if (/MONTHLY FEE/i.test(desc)) return 'Santander account fee';
    for (const p of pats) { const m = desc.match(p); if (m) return m[1].replace(/\s+/g, ' ').trim(); }
    return desc.split(/ REF| ON \d|,/i)[0].trim().slice(0, 40);
  }

  /** Parse one statement. Returns { ok, period, opening, closing, txns, checks, problems }. */
  function parseSantander(pages, sourceName) {
    const lines = toLines(pages);
    const all = lines.map(l => l.text).join(' ');
    const problems = [];
    if (!/santander/i.test(all)) return { ok: false, problems: ['This does not look like a Santander statement.'], txns: [] };
    const period = findPeriod(all);
    if (!period) return { ok: false, problems: ['Could not find the statement period.'], txns: [] };

    const totalIn = findTotal(all, /Total money in:? £?([\d,]+\.\d{2})/i);
    const totalOut = findTotal(all, /Total money out:? -?£?([\d,]+\.\d{2})/i);
    const closingStated = findTotal(all, /balance at close of business[^£]*£(-?[\d,]+\.\d{2})/i);

    // Token stream from the transaction table. On real Santander statements the date and the
    // amounts sit vertically between the lines of a two-line description, so each transaction is
    // anchored on its date and the nearest description lines are attached to it by position.
    const toks = [];
    const anchored = anchoredLines(pages);
    if (anchored.length) {
      for (const t of anchored) { t.split(' ').forEach(w => { if (w) toks.push(w); }); if (/Balance carried forward/i.test(t)) break; }
    } else {
      const startIdx = lines.findIndex(l => /^Your transactions/i.test(l.text));
      if (startIdx < 0) return { ok: false, problems: ['Could not find the transactions table.'], txns: [] };
      for (let i = startIdx + 1; i < lines.length; i++) {
        let t = lines[i].text;
        if (/Balance carried forward/i.test(t)) { t.split(' ').forEach(w => toks.push(w)); break; }
        if (NOISE.some(r => r.test(t))) {
          t = t.replace(/^.*?Money in Money out £? ?Balance/i, '').replace(/^Your transactions.*?\d{4}/i, '');
          if (NOISE.some(r => r.test(t))) continue;
        }
        if (!t.trim()) continue;
        t.split(' ').forEach(w => { if (w) toks.push(w); });
      }
    }

    let prev = null, opening = null;
    const txns = [];
    let cur = null; // { date, words: [] }

    const isDateAt = i => DAY_RE.test(toks[i] || '') && MON_RE.test(toks[i + 1] || '');

    function tryClose() {
      // find the first adjacent money pair (amount, balance) consistent with the running balance
      const w = cur.words;
      for (let k = 0; k < w.length - 1; k++) {
        if (!MONEY_RE.test(w[k]) || !MONEY_RE.test(w[k + 1])) continue;
        const amt = money(w[k]), bal = money(w[k + 1]);
        const delta = bal - prev;
        if (Math.abs(Math.abs(delta) - Math.abs(amt)) === 0 && amt !== 0) {
          const desc = w.slice(0, k).concat(w.slice(k + 2)).join(' ').replace(/\s+,/g, ',').trim();
          txns.push({ date: iso(cur.date), desc, amount: delta, balance: bal });
          prev = bal;
          return k + 2 === w.length ? 'end' : 'trail';
        }
      }
      return null;
    }

    for (let i = 0; i < toks.length; i++) {
      if (isDateAt(i)) {
        if (cur && !cur.closed && prev !== null) problems.push('Unmatched row: ' + cur.words.join(' ').slice(0, 80));
        cur = { date: dateFor(+toks[i].match(DAY_RE)[1], toks[i + 1], period), words: [], closed: false };
        i++;
        continue;
      }
      if (!cur) continue;
      const tok = toks[i];
      if (cur.closed) {
        // text after the amounts but before the next date: a wrapped description line
        if (!MONEY_RE.test(tok) && txns.length) txns[txns.length - 1].desc += ' ' + tok;
        continue;
      }
      cur.words.push(tok);
      const txt = cur.words.join(' ');
      if (/^Balance brought forward/i.test(txt) && MONEY_RE.test(tok)) {
        opening = prev = money(tok); cur.closed = true; continue;
      }
      if (/^Balance carried forward/i.test(txt)) {
        if (MONEY_RE.test(tok)) { cur.closed = true; }
        continue;
      }
      if (prev === null) continue;
      if (MONEY_RE.test(tok) && cur.words.length >= 2) {
        const r = tryClose();
        if (r) cur.closed = true;
      }
    }
    if (cur && !cur.closed) problems.push('Unmatched row: ' + cur.words.join(' ').slice(0, 80));

    txns.forEach(t => {
      t.desc = t.desc.replace(/\s+/g, ' ').trim();
      t.kind = kindOf(t.desc);
      t.payee = payeeOf(t.desc);
      t.account = 'Santander joint';
      t.source = sourceName || '';
    });

    const sumIn = txns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const sumOut = -txns.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    const closing = txns.length ? txns[txns.length - 1].balance : opening;
    const checks = {
      moneyIn: totalIn === null ? null : sumIn === totalIn,
      moneyOut: totalOut === null ? null : sumOut === totalOut,
      closing: closingStated === null ? null : closing === closingStated
    };
    if (checks.moneyIn === false) problems.push(`Money in adds to £${(sumIn / 100).toFixed(2)}, statement says £${(totalIn / 100).toFixed(2)}.`);
    if (checks.moneyOut === false) problems.push(`Money out adds to £${(sumOut / 100).toFixed(2)}, statement says £${(totalOut / 100).toFixed(2)}.`);
    if (checks.closing === false) problems.push(`Closing balance £${(closing / 100).toFixed(2)} ≠ statement £${(closingStated / 100).toFixed(2)}.`);

    return {
      ok: problems.length === 0,
      period: { start: iso(period.start), end: iso(period.end) },
      opening, closing, totalIn, totalOut, txns, checks, problems
    };
  }

  const api = { extractPages, parseSantander, toLines, kindOf, payeeOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FinParser = api;
})(typeof self !== 'undefined' ? self : this);
