/* EXPERIMENT: a generic, bank-agnostic statement table reader.
 * It knows nothing about any bank. It finds the transaction table from its header words and column
 * positions, reads the rows, then PROVES the result with arithmetic (running balances, printed totals).
 * If nothing can be proved it says so (confidence 'unverified'); if the sums disagree it fails.
 * Not wired into the app. Run it with tools/smart-eval.js.
 * Input: pages = [[{str,x,y,w}]] from parser.extractPages (w = text width, optional).
 */
(function (root) {
  'use strict';
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const MON = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
  const pad = n => String(n).padStart(2, '0');
  const iso = (y, m, d) => y + '-' + pad(m + 1) + '-' + pad(d);

  // ---------------------------------------------------------------- cells and rows
  /** Group items into rows, then merge touching items into cells. */
  function toRows(pages) {
    const rows = [];
    pages.forEach((items, p) => {
      const rs = [];
      items.filter(i => i.str && i.str.trim()).forEach(i => {
        let r = rs.find(r => Math.abs(r.y - i.y) < 2.5);
        if (!r) { r = { y: i.y, items: [] }; rs.push(r); }
        r.items.push(i);
      });
      rs.sort((a, b) => b.y - a.y).forEach(r => {
        r.items.sort((a, b) => a.x - b.x);
        const cells = [];
        r.items.forEach(i => {
          const w = i.w != null ? i.w : i.str.length * 5;
          const last = cells[cells.length - 1];
          if (last && i.x - (last.x + last.w) < 4 && !(/^[-−]?£?[\d,]+\.\d{2}$/.test(i.str.trim()) && /[A-Za-z]/.test(last.str))) { last.str += (i.x - (last.x + last.w) > 0.8 ? ' ' : '') + i.str.trim(); last.w = i.x + w - last.x; }
          else cells.push({ str: i.str.trim(), x: i.x, w });
        });
        rows.push({ page: p, y: r.y, cells, text: cells.map(c => c.str).join(' ') });
      });
    });
    return rows;
  }

  // ---------------------------------------------------------------- header words -> column roles
  const ROLE = [
    ['date', /^(?:transaction |trans\.? |posting |posted |value |booking )?date(?: posted)?$/i],
    ['desc', /^(?:description|details|transaction details|transaction|narrative|payee|particulars|reference|transaction description|merchant)$/i],
    ['in', /^(?:paid in|money in|credits?|credit amount|deposits?|payments? in|in|credit \(£\)|paid in \(£\)|money in \(£\))$/i],
    ['out', /^(?:paid out|money out|debits?|debit amount|withdrawals?|payments? out|out|debit \(£\)|paid out \(£\)|money out \(£\)|withdrawn)$/i],
    ['amt', /^(?:amount|value)$/i],
    ['bal', /^(?:(?:end of day |running |closing )?(?:account )?balance)$/i],
  ];
  const roleOf = s => { const t = s.replace(/\(?(?:£|gbp)\)?/ig, ' ').replace(/\s+/g, ' ').trim(); if (!t) return null; for (const [r, re] of ROLE) if (re.test(t)) return r; return null; };
  const HEAD_FRAGMENT = /^(?:paid|money|account|end of day|payments?|transaction|trans|balance|amount|credit|debit|value|date|description)$/i;

  /** Find the header row of a transaction table: needs a date column and at least two amount-type columns (or one + description). */
  function headerOf(rows, i) {
    const r = rows[i];
    let cells = r.cells.map(c => Object.assign({}, c));
    // join wrapped header words ("Paid" over "out") from the row just below
    const nxt = rows[i + 1];
    if (nxt && nxt.page === r.page && r.y - nxt.y < 16 && cells.some(c => HEAD_FRAGMENT.test(c.str))) {
      cells = cells.map(c => {
        if (!HEAD_FRAGMENT.test(c.str)) return c;
        const below = nxt.cells.find(b => Math.abs((b.x + b.w / 2) - (c.x + c.w / 2)) < 30 && roleOf(c.str + ' ' + b.str));
        return below ? { str: c.str + ' ' + below.str, x: Math.min(c.x, below.x), w: Math.max(c.x + c.w, below.x + below.w) - Math.min(c.x, below.x), joined: true } : c;
      });
    }
    // a cell holding several header words ("Paid in Paid out Balance") is split on the known phrases
    const out = [];
    cells.forEach(c => {
      if (roleOf(c.str)) { out.push(Object.assign({ role: roleOf(c.str) }, c)); return; }
      const re = /(?:transaction details|paid in|paid out|money in|money out|payments? in|payments? out|balance|description|details|date|amount|credits?|debits?)/gi;
      let m; const found = [];
      while ((m = re.exec(c.str))) found.push(m);
      if (found.length >= 2 && c.str.replace(new RegExp(re.source, 'gi'), '').replace(/[\s£()\/&,-]/g, '').length <= 2) found.forEach(m => out.push({ role: roleOf(m[0]), str: m[0], x: c.x + c.w * (m.index / c.str.length), w: c.w * (m[0].length / c.str.length) }));
    });
    const roles = out.filter(c => c.role);
    const amt = roles.filter(c => ['in', 'out', 'amt', 'bal'].includes(c.role)).length;
    if (roles.some(c => c.role === 'date') && amt >= 1 && roles.length >= 3 && roles.length === new Set(roles.map(c => c.role + Math.round(c.x))).size) {
      const seen = new Set(); const uniq = roles.filter(c => { if (seen.has(c.role)) return false; seen.add(c.role); return true; });
      return { cols: uniq, skip: out.length && cells.some(c => c.joined) ? 1 : 0 };
    }
    return null;
  }

  // ---------------------------------------------------------------- values
  const AMT = /^[-−–(]?\s*£?\s*[-−–]?\s*[\d,]*\d\.\d{2}\s*[-−–)]?\s*(?:CR|DR|Cr|Dr|cr|dr)?$/;
  const isAmount = s => AMT.test(s.trim());
  /** -> { v: pence (as printed, positive unless a minus/brackets), mark: 'CR'|'DR'|'' } */
  function amountOf(s) {
    const t = s.trim();
    const neg = /^[-−–(]/.test(t) || /^£?\s*[-−–]/.test(t) || /\d\s*[-−–]\s*(?:CR|DR)?$/i.test(t);
    const mark = (t.match(/(CR|DR)$/i) || [''])[0].toUpperCase();
    const n = Math.round(parseFloat(t.replace(/[^\d.]/g, '')) * 100);
    return { v: neg ? -n : n, mark };
  }
  const DATE_RES = [
    [new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?[ \\-/.](${MON})[ \\-/.,]*(\\d{4}|\\d{2})?(?![\\d])`, 'i'), m => ({ d: +m[1], m: MONTHS[m[2].slice(0, 3).toLowerCase()], y: m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null })],
    [/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4}|\d{2})(?!\d)/, m => ({ d: +m[1], m: +m[2] - 1, y: m[3].length === 2 ? 2000 + +m[3] : +m[3] })],
    [new RegExp(`^(${MON}) (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?(?!\\d)`, 'i'), m => ({ d: +m[2], m: MONTHS[m[1].slice(0, 3).toLowerCase()], y: m[3] ? +m[3] : null })],
  ];
  /** Leading date in a string -> { d, m, y|null, len } or null. */
  function dateIn(s) {
    const t = s.trim();
    for (const [re, f] of DATE_RES) { const m = t.match(re); if (m) { const o = f(m); if (o.d >= 1 && o.d <= 31 && o.m >= 0 && o.m <= 11) { o.len = m[0].length; return o; } } }
    return null;
  }

  // ---------------------------------------------------------------- statement-level facts
  function findPeriod(text) {
    const D = `(\\d{1,2}(?:st|nd|rd|th)?[ /.-](?:${MON}|\\d{1,2})[ \\/.,-]*\\d{2,4})`;
    let m = text.match(new RegExp(`${D}\\s*(?:to|-|–|until|through)\\s*${D}`, 'i'));
    if (m) {
      const a = dateIn(m[1]), b = dateIn(m[2]);
      if (a && b && a.y && b.y) return { start: iso(a.y, a.m, a.d), end: iso(b.y, b.m, b.d) };
    }
    // "1 August to 30 August 2024", "01 - 30 Sep 2022", "1 Sep - 30 Sep 2022": the year is printed once
    m = text.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(${MON}))?(?:\\s+\\d{4})?\\s*(?:to|-|–|until|through)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MON})[ ,]+(\\d{4})`, 'i'));
    if (m) {
      const em = MONTHS[m[4].slice(0, 3).toLowerCase()], sm = m[2] ? MONTHS[m[2].slice(0, 3).toLowerCase()] : em, ey = +m[5], sy = sm > em ? ey - 1 : ey;
      return { start: iso(sy, sm, +m[1]), end: iso(ey, em, +m[3]) };
    }
    return null;
  }
  /** When no period is printed: the statement date, or failing that the latest full date on the statement. */
  function referenceEnd(text) {
    const sd = text.match(new RegExp(`(?:statement date|date of statement|statement issued|issue date)[: ]+(\\d{1,2}(?:st|nd|rd|th)?[ /.-](?:${MON}|\\d{1,2})[ \\/.,-]*\\d{2,4})`, 'i'));
    if (sd) { const d = dateIn(sd[1]); if (d && d.y) return iso(d.y, d.m, d.d); }
    let best = null;
    const re = new RegExp(`\\b(\\d{1,2}(?:st|nd|rd|th)?[ /.-](?:${MON}|\\d{1,2})[ \\/.,-]*\\d{4})\\b`, 'gi'); let m;
    while ((m = re.exec(text))) { const d = dateIn(m[1]); if (d && d.y) { const v = iso(d.y, d.m, d.d); if (!best || v > best) best = v; } }
    return best;
  }
  const LABELS = {
    opening: /(?:opening balance|previous closing balance|previous statement balance|previous balance|balance brought forward|brought forward|start balance|balance at start|your previous balance|last statement balance|balance b\/f)/i,
    closing: /(?:(?<!previous )closing balance|new balance|statement balance|balance carried forward|carried forward|end balance|balance at (?:close|end)|balance c\/f)/i,
    totalIn: /(?:total (?:money |paid |payments? )?in\b|payments? in\b|total credits|total deposits|money in|paid in|new credits|payments? received)/i,
    totalOut: /(?:total (?:money |paid |payments? )?out\b|payments? out\b|total debits|total withdrawals|money out|paid out|withdrawn|new debits)/i,
  };
  const SQUASHED = Object.fromEntries(Object.entries(LABELS).map(([k, re]) => [k, new RegExp(re.source.replace(/ /g, ''), 'i')]));
  /** Printed figures: the first amount after the label on the same row, or directly under it. */
  function printedFigures(rows) {
    const out = {};
    rows.forEach((r, i) => {
      for (const k of Object.keys(LABELS)) {
        if (out[k] != null) continue;
        let m = LABELS[k].exec(r.text), txt = r.text;
        if (!m) { txt = r.text.replace(/\s+/g, ''); m = SQUASHED[k].exec(txt); } // some PDFs split words ("Clos ing Balance", "23,235.1 5")
        if (!m) continue;
        const rest = txt.slice(m.index + m[0].length);
        const hit = rest.match(/^.{0,45}?(-?\s?£?\s?-?[\d,]*\d\.\d{2})\s*(CR|DR)?/);
        if (hit) { out[k] = amountOf(hit[1] + (hit[2] || '')); continue; }
        const under = rows[i + 1];
        if (under && under.page === r.page && r.y - under.y < 20) {
          const c0 = r.cells.find(c => LABELS[k].test(c.str)); const b = c0 && under.cells.find(x => Math.abs(x.x - c0.x) < 40 && isAmount(x.str));
          if (b) out[k] = amountOf(b.str);
        }
      }
    });
    return out;
  }

  // ---------------------------------------------------------------- main
  const MARKER = /(?:brought|carried) forward|opening balance|closing balance|start balance|end balance|new balance|previous balance|balance b\/f|balance c\/f/i;

  /** Walk the rows once under one reading of how undated rows behave.
   *  strict: a row without a date only continues the transaction above it.
   *  amount: a row without a date that carries its own amounts, under a finished transaction, is a new transaction on the same date (statements that print the date once per day).
   *  text:   additionally, a text-only row under a finished transaction starts a new one. */
  function scan(rows, mode, period) {
    let cols = null, cur = null, tableNo = 0, lastDate = null, columns = null;
    const raw = [], skipRows = new Set(), startGaps = [], contGaps = [];
    let prevY = null, prevPage = -1;
    const done = t => t && (t.in != null || t.out != null || t.amt != null);
    for (let i = 0; i < rows.length; i++) {
      let r = rows[i];
      const gap = prevPage === r.page && prevY != null ? prevY - r.y : null; prevY = r.y; prevPage = r.page;
      const h = headerOf(rows, i);
      if (h) { cols = h.cols; cur = null; tableNo++; if (h.skip) skipRows.add(i + 1); columns = cols.map(c => c.role); continue; }
      if (skipRows.has(i) || !cols) continue;
      const dateCol = cols.find(c => c.role === 'date'); let descCol = cols.find(c => c.role === 'desc');
      if (!descCol) { // header words were split or unusual: the description starts at the first text after the date column
        const firstAmt = Math.min(...cols.filter(c => ['in', 'out', 'amt', 'bal'].includes(c.role)).map(c => c.x));
        const xs = rows.slice(i, i + 40).filter(q => q.page === r.page).flatMap(q => q.cells.filter(c => c.x > dateCol.x + dateCol.w + 2 && c.x < firstAmt - 20 && !isAmount(c.str) && !dateIn(c.str)).map(c => c.x));
        descCol = { role: 'desc', x: xs.length ? Math.min(...xs) : dateCol.x + dateCol.w + 8, w: 0 };
      }
      const amtCols = cols.filter(c => ['in', 'out', 'amt', 'bal'].includes(c.role));
      const nearest = c => { // which amount column a numeric cell belongs to
        let best = null, bd = 1e9;
        amtCols.forEach(a => {
          const d = Math.min(Math.abs((c.x + c.w) - (a.x + a.w)), Math.abs(c.x - a.x), Math.abs((c.x + c.w / 2) - (a.x + a.w / 2)));
          if (d < bd) { bd = d; best = a; }
        });
        return bd <= 45 ? best : null;
      };
      const place = (t, c) => {
        if (/^(?:CR|DR)$/i.test(c.str) && (t.amt != null || t.in != null || t.out != null)) { t.mark = c.str.toUpperCase(); return; }
        if (!t.parts.length && !isAmount(c.str)) { // a second date (posting date) or a bare reference number straight after the date is not description
          const d2 = dateIn(c.str); if (d2 && d2.len === c.str.length) return;
          if (/^\d{6,}$/.test(c.str) && !t.refSkipped) { t.refSkipped = true; return; }
        }
        if (isAmount(c.str)) {
          const col = nearest(c);
          if (col) { const a = amountOf(c.str); if (t[col.role] == null) { t[col.role] = a.v; if (a.mark) t.mark = a.mark; } return; }
        }
        t.parts.push(c.str);
      };
      const rightEdge = Math.max(...amtCols.map(c => c.x + c.w)) + 25; // notices printed beside the table are not part of it
      if (r.cells.some(c => c.x > rightEdge)) r = Object.assign({}, r, { cells: r.cells.filter(c => c.x <= rightEdge) });
      if (!r.cells.length) continue;
      const first = r.cells[0];
      if (/^(?:sub-?total\b|total\b|page \d|continued\b)/i.test(r.cells.filter(c => !dateIn(c.str) || dateIn(c.str).len < c.str.length)[0] ? r.cells.filter(c => !dateIn(c.str) || dateIn(c.str).len < c.str.length)[0].str : '')) { cur = null; continue; }
      const dateRight = descCol && descCol.x > dateCol.x ? descCol.x - 5 : dateCol.x + 60; // a date-looking line in the description column is still description
      const dt = first && first.x < dateRight && dateIn(first.str);
      if (MARKER.test(r.text) && r.cells.length <= 4) {
        if (dt) lastDate = dt;
        const bal = r.cells.filter(c => isAmount(c.str)).pop();
        if (bal) raw.push({ marker: /carried|closing|end|new balance/i.test(r.text) ? 'closing' : 'opening', bal: amountOf(bal.str).v, table: tableNo });
        cur = null; continue;
      }
      const fresh = date => { cur = { date, parts: [], in: null, out: null, amt: null, bal: null, mark: '', page: r.page, lastY: r.y, table: tableNo }; raw.push(cur); return cur; };
      if (dt) {
        if (gap != null) startGaps.push(gap);
        lastDate = dt; fresh(dt);
        let rest = first.str.slice(dt.len).trim();
        const d2 = rest && dateIn(rest); if (d2 && d2.len < rest.length) rest = rest.slice(d2.len).trim();
        if (rest) cur.parts.push(rest);
        r.cells.slice(1).forEach(c => place(cur, c));
      } else {
        const hasAmt = r.cells.some(c => isAmount(c.str) && nearest(c) && nearest(c).role !== 'bal');
        const startsInDesc = first && descCol && first.x >= descCol.x - 5 && first.x < descCol.x + 40 && !isAmount(first.str);
        const near = cur && (r.page !== cur.page || cur.lastY - r.y <= 20);
        if (mode !== 'strict' && lastDate && startsInDesc && (!cur || !near || (done(cur) && (hasAmt || mode === 'text')))) {
          if (gap != null) startGaps.push(gap);
          fresh(lastDate); r.cells.forEach(c => place(cur, c));
        } else if (cur && near) { if (gap != null) contGaps.push(gap); r.cells.forEach(c => place(cur, c)); }
        else cur = null; // footer, notes, anything not under a transaction
      }
      if (cur) cur.lastY = r.y;
    }
    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    // in a correct reading, the line spacing before a new transaction is not smaller than before a continuation line
    const spacing = startGaps.length > 2 && contGaps.length > 2 ? Math.max(-4, Math.min(4, mean(startGaps) - mean(contGaps))) / 4 : 0;
    return { raw, cols, columns, spacing };
  }

  function read(pages, name) {
    const rows = toRows(pages);
    const notes = [], problems = [];
    const textAll = rows.map(r => r.text).join('\n');
    const period = findPeriod(textAll);
    const out = { type: 'generic', institution: 'Unknown bank (auto-detected)', name, period, notes, problems, txns: [], confidence: 'failed', ok: false };
    const printed = printedFigures(rows);
    // this reader assumes UK statements: day-first dates and pounds. A month-first date (e.g. 07/23/24) or dollar amounts means it would misread days as months.
    const slash = [...textAll.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g)];
    const monthFirst = slash.some(m => +m[2] > 12) && !slash.some(m => +m[1] > 12);
    const dollars = (textAll.match(/\$\s?[\d,]+\.\d{2}/g) || []).length, pounds = (textAll.match(/£\s?[\d,]+\.\d{2}/g) || []).length;
    if (monthFirst || dollars > pounds + 5) { problems.push('Not a UK-style statement (month-first dates or dollar amounts), so it is not read: day and month could be swapped.'); out.confidence = 'failed'; return out; }

    const refEnd = period ? period.end : referenceEnd(textAll);
    const yearOf = d => {
      if (d.y) return d.y;
      if (!refEnd) return null;
      const ey = +refEnd.slice(0, 4), em = +refEnd.slice(5, 7) - 1;
      return d.m > em + 1 ? ey - 1 : ey;
    };
    const credit = /payment received|thank you|refund|cashback|reversal|credit adjustment/i;
    const cardWords = /credit limit|minimum payment|previous balance|new balance|payments? and credits|credit card/i.test(textAll);
    let best = null, anyTable = false, undated = false;

    ['strict', 'amount', 'text'].forEach((mode, level) => {
      if (process.env.SMART_MODE && process.env.SMART_MODE !== mode) return;
      const sc = scan(rows, mode, period);
      if (!sc.cols) return;
      anyTable = true;
      const hasInOut = sc.cols.some(c => c.role === 'in' || c.role === 'out');
      const hasBal = sc.cols.some(c => c.role === 'bal');
      const markers = sc.raw.filter(t => t.marker);
      // transactions plus balance checkpoints (brought/carried forward rows), in page order
      let draft = sc.raw.map(t => t.marker
        ? { mk: true, amount: 0, bal: t.bal, table: t.table, desc: '' }
        : { date: null, _d: t.date, desc: t.parts.join(' ').replace(/\s+/g, ' ').trim(), _in: t.in, _out: t.out, _amt: t.amt, bal: t.bal, mark: t.mark, table: t.table });
      draft = draft.filter(t => t.mk || t._in != null || t._out != null || t._amt != null); // a "transaction" with no amount is a stray line
      if (draft.some(t => !t.mk && !yearOf(t._d))) return;
      draft.forEach(t => {
        if (t.mk) return;
        t.date = iso(yearOf(t._d), t._d.m, t._d.d);
        t.amount = hasInOut ? (t._in != null ? Math.abs(t._in) : 0) - (t._out != null ? Math.abs(t._out) : 0) : (t._amt == null ? 0 : t._amt);
      });
      if (!draft.some(t => !t.mk)) return;
      const pr = Object.assign({}, printed);
      const op = markers.find(m => m.marker === 'opening'), cl = markers.slice().reverse().find(m => m.marker === 'closing');
      if (op && !pr.opening) pr.opening = { v: op.bal };
      if (cl && !pr.closing && markers.filter(m => m.marker === 'closing').length === 1) pr.closing = { v: cl.bal };
      const hyps = [];
      if (hasInOut) hyps.push({ name: 'in/out columns', f: t => t.amount });
      else {
        hyps.push({ name: 'bank: amounts signed as printed', f: t => t.mark === 'CR' ? Math.abs(t._amt) : t.mark === 'DR' ? -Math.abs(t._amt) : t._amt });
        hyps.push({ name: 'card: printed amounts are spend, CR or minus is a credit', card: true, f: t => t.mark === 'CR' ? Math.abs(t._amt) : -t._amt });
      }
      hyps.forEach(h => {
        const tx = draft.map(t => t.mk ? t : Object.assign({}, t, { amount: h.f(t) }));
        const real = tx.filter(t => !t.mk);
        const res = verify(tx, pr, hasBal, !!h.card);
        // when arithmetic cannot decide, wording and tidiness break the tie
        const sem = real.reduce((s, t) => s + (credit.test(t.desc) ? (t.amount > 0 ? 1 : -1) : 0), 0);
        const heads = {}; real.forEach(t => { const k = t.desc.split(' ').slice(0, 2).join(' ').toLowerCase(); heads[k] = (heads[k] || 0) + 1; });
        const tidy = real.filter(t => heads[t.desc.split(' ').slice(0, 2).join(' ').toLowerCase()] > 1).length / real.length;
        res.score += Math.max(-3, Math.min(3, sem)) * 0.5 + (h.card && cardWords ? 1 : 0) + (!h.card && cardWords ? -1 : 0) + tidy * 0.5 + sc.spacing - level * 0.1;
        if (process.env.SMART_DEBUG) console.log('  [mode]', mode, h.name, 'rows', real.length, 'conf', res.confidence, 'score', res.score.toFixed(2), 'tidy', tidy.toFixed(2), JSON.stringify(Object.fromEntries(Object.entries(res.checks).map(([k, v]) => [k, v.msg]))));
        if (!best || res.score > best.res.score) best = { h, tx: real, res, sc, pr, mode };
      });
    });
    if (!anyTable) { problems.push('No transaction table found (no header row with a date column and amount columns).'); return out; }
    if (!best) { problems.push('A table was found but its dates have no year and no statement period or date was found to place them in.'); return out; }
    out.columns = best.sc.columns; out.rows = best.tx.length; out.undatedRows = best.mode;
    out.txns = best.tx.map(t => ({ date: t.date, desc: t.desc, amount: t.amount, balance: t.bal, payee: t.desc.slice(0, 40) }));
    out.checks = best.res.checks; out.convention = best.h.name; out.confidence = best.res.confidence;
    out.opening = best.pr.opening ? best.pr.opening.v : null; out.closing = best.pr.closing ? best.pr.closing.v : null;
    if (best.res.confidence === 'verified' && !best.tx.some(t => t.amount !== 0)) { best.res.confidence = 'failed'; best.res.msgs.push('Every amount read as zero, so the arithmetic proves nothing (placeholder or blank statement?).'); out.confidence = 'failed'; }
    out.ok = best.res.confidence === 'verified';
    if (best.res.confidence === 'failed') problems.push(...best.res.msgs);
    if (best.res.confidence === 'unverified') notes.push('Nothing on the statement could be used to prove these figures (no running balance or printed totals found).');
    if (!out.period && out.txns.length) { const ds = out.txns.map(t => t.date).sort(); out.period = { start: ds[0], end: ds[ds.length - 1] }; notes.push('Period taken from the first and last transaction.'); }
    return out;
  }

  /** Test a reading against the statement's own arithmetic. */
  function verify(tx, printed, hasBal, card) {
    const checks = {}, msgs = []; let passed = 0, failed = 0;
    // running balance: between two printed balances, the amounts must add up
    if (hasBal) {
      const seg = list => { let ok = 0, bad = 0, prev = null, sum = 0;
        list.forEach(t => { if (t.bal == null) { sum += t.amount; return; }
          if (prev != null) { if (prev + sum + t.amount === t.bal) ok++; else bad++; }
          prev = t.bal; sum = 0; });
        return { ok, bad }; };
      const s = { ok: 0, bad: 0 }; const orders = [];
      [...new Set(tx.map(t => t.table))].forEach(id => {   // each table (main account, a pot, ...) has its own running balance
        const part = tx.filter(t => t.table === id); const a = seg(part), b = seg(part.slice().reverse());
        const pick = a.ok >= b.ok ? a : b; s.ok += pick.ok; s.bad += pick.bad; orders.push(a.ok >= b.ok ? 'as printed' : 'reversed');
      });
      const a = { ok: 1 }, b = { ok: 0 }; void a; void b;
      checks.chain = { ok: s.bad === 0 && s.ok > 0, segments: s.ok + s.bad, passed: s.ok, order: orders.join(', '), msg: `Running balance: ${s.ok} of ${s.ok + s.bad} stretches add up` };
      if (s.ok + s.bad > 0) { if (checks.chain.ok) passed++; else { failed++; msgs.push(checks.chain.msg); } }
    }
    const net = tx.reduce((s, t) => s + t.amount, 0);
    if (printed.opening && printed.closing) {
      const want = (printed.closing.v - printed.opening.v) * (card ? -1 : 1);
      checks.totals = { ok: net === want, net, want, msg: `Opening + transactions ≠ closing (net ${net}, statement implies ${want})` };
      if (checks.totals.ok) passed++; else { failed++; msgs.push(checks.totals.msg); }
    }
    if (printed.totalIn && printed.totalOut) {
      const tin = tx.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0), tout = tx.filter(t => t.amount < 0).reduce((s, t) => s - t.amount, 0);
      const ok = tin === Math.abs(printed.totalIn.v) && tout === Math.abs(printed.totalOut.v);
      checks.inout = { ok, tin, tout, msg: `Money in/out read as ${tin}/${tout}, statement says ${Math.abs(printed.totalIn.v)}/${Math.abs(printed.totalOut.v)}` };
      if (ok) passed++; else { failed++; msgs.push(checks.inout.msg); }
    }
    if (printed.opening && printed.closing && printed.totalIn && printed.totalOut) {
      const implied = printed.opening.v + Math.abs(printed.totalIn.v) * (card ? -1 : 1) - Math.abs(printed.totalOut.v) * (card ? -1 : 1), diff = implied - printed.closing.v;
      if (diff !== 0) { checks.summary = { ok: false, diff, msg: `The statement's own summary does not add up: opening ${printed.opening.v} + in − out = ${implied}, but it prints closing ${printed.closing.v} (difference ${diff} pence)` }; failed++; msgs.push(checks.summary.msg); }
    }
    const confidence = failed ? 'failed' : passed ? 'verified' : 'unverified';
    return { checks, msgs, confidence, score: passed * 10 - failed * 10 + (tx.length ? 1 : 0) };
  }

  const api = { read, toRows, headerOf, dateIn, amountOf, findPeriod };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  (root.FinSmart = api);
})(typeof self !== 'undefined' ? self : this);
