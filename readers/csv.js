/* EXPERIMENT: a generic, bank-agnostic CSV statement reader (sister of readers/smart.js).
 * Knows nothing about any bank. Finds the header row from its words, maps columns by NAME (never by position),
 * reads the rows, then PROVES the result with the running balance when there is one.
 *   verified   the running balance adds up across every row that has one
 *   unverified rows were read but the file has no balance to prove them against (shown with a warning)
 *   failed     the arithmetic disagrees, or the file is not a UK-style statement, or rows could not be read safely
 * Not wired into the app. Run it with tools/csv-eval.js. Everything is treated as text: nothing in a cell is ever evaluated.
 * Input: a string, or bytes (Uint8Array/Buffer). Money is whole pence; spend is negative.
 */
(function (root) {
  'use strict';
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const pad = n => String(n).padStart(2, '0');

  // ---------------------------------------------------------------- what kind of file is this?
  /** 'pdf' | 'csv' | 'unknown' from the file's own bytes (not its extension). */
  function sniff(input) {
    const b = typeof input === 'string' ? null : input;
    const head = b ? Array.from(b.slice(0, 8)) : null;
    if (b ? (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) : /^\s*%PDF/.test(input.slice(0, 16))) return 'pdf';
    let text; try { text = decode(input); } catch (e) { return 'unknown'; }
    if (text.indexOf('\u0000') >= 0 || /[\u0001-\u0008\u000e-\u001f]/.test(text.slice(0, 4000))) return 'unknown';
    const first = text.split(/\r\n|\r|\n/).filter(l => l.trim()).slice(0, 12);
    if (first.length >= 1 && first.some(l => (l.match(/[,;\t|]/g) || []).length >= 2)) return 'csv';
    return 'unknown';
  }

  // ---------------------------------------------------------------- bytes -> text
  function decode(input) {
    if (typeof input === 'string') return input.replace(/^﻿/, '');
    const b = input;
    if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return new TextDecoder('utf-8').decode(b.slice(3));
    if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.slice(2));
    if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.slice(2));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b); }
    catch (e) { return new TextDecoder('windows-1252').decode(b); }   // old exports: £ is a single byte 0xA3
  }

  // ---------------------------------------------------------------- CSV text -> rows of cells (quotes, doubled quotes, newlines inside quotes)
  function parseCSV(text, delim) {
    const rows = []; let row = [], cell = '', q = false, i = 0, atStart = true;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
        cell += c; i++; continue;
      }
      if (c === '"' && atStart) { q = true; atStart = false; i++; continue; }
      if (c === delim) { row.push(cell); cell = ''; atStart = true; i++; continue; }
      if (c === '\r' || c === '\n') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; atStart = true; i++; continue; }
      cell += c; atStart = false; i++;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return { rows, unterminatedQuote: q };
  }
  function sniffDelimiter(text) {
    const head = text.slice(0, 12000); let best = ',', bestScore = 0;
    for (const d of [',', ';', '\t', '|']) {
      const { rows } = parseCSV(head, d);
      const counts = rows.filter(r => r.length >= 3).map(r => r.length);
      if (!counts.length) continue;
      const freq = {}; counts.forEach(c => { freq[c] = (freq[c] || 0) + 1; });
      const [mode, f] = Object.entries(freq).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
      const score = f * Math.min(+mode, 12);
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  // ---------------------------------------------------------------- headers
  const norm = h => String(h).toLowerCase().replace(/[()£]/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const ROLE = [
    ['state', /^(state|status)$/],
    ['flag', /^(debit credit flag|debit credit indicator|credit debit flag|credit debit indicator|dr cr|cr dr|dr cr flag|dr cr indicator|debit or credit|credit or debit|transaction indicator|d c indicator)$/],
    ['fee', /^fees?$/],
    ['cur', /^currency$/],
    ['bal', /^((running|account|closing|available|ledger) )?(balance|bal)( after)?( gbp)?$/],
    ['in', /^(paid in|money in|credit|credits|credit amount|credit amt|deposits?|payments? in|amount in|amount credited|received|in)$/],
    ['out', /^(paid out|money out|debit|debits|debit amount|debit amt|withdrawals?|withdrawn|payments? out|amount out|amount debited|spent|out)$/],
    ['amt', /^(amount|value|amount gbp|amount in gbp|transaction amount|billing amount|billed amount|net amount|debit credit|credit debit|transaction value|amount charged|amt)$/],
    ['date', /^((transaction|trans|posting|posted|completed|started|value|booking|processed|effective) )?date( of transaction)?$/],
    ['desc', /^(description|transaction description|transaction details|details|memo|narrative|transaction narrative|particulars|reference|name|counter ?party|payee|payee name|merchant|merchant name|merchant description|merchant description|merchant details|description merchant)$/],
  ];
  const DATE_PRIO = { 'transaction date': 4, 'trans date': 4, 'date of transaction': 4, 'effective date': 3, 'date': 4, 'completed date': 4, 'booking date': 3, 'processed date': 3, 'posting date': 2, 'posted date': 1, 'started date': 1, 'value date': 0 };
  const DESC_PRIO = ['name', 'counter party', 'counterparty', 'payee', 'payee name', 'merchant', 'merchant name', 'merchant description', 'transaction description', 'transaction details', 'description', 'details', 'narrative', 'transaction narrative', 'particulars', 'memo', 'reference'];
  const roleOf = h => { const n = norm(h); for (const [r, re] of ROLE) if (re.test(n)) return r; return null; };

  function findHeader(rows) {
    for (let i = 0; i < Math.min(rows.length, 60); i++) {
      const r = rows[i]; if (r.filter(c => c.trim()).length < 3) continue;
      const roles = r.map(roleOf);
      const has = k => roles.includes(k);
      if (has('date') && (has('amt') || has('in') || has('out')) && roles.filter(Boolean).length >= 3) return { index: i, cells: r, roles };
    }
    return null;
  }

  // ---------------------------------------------------------------- values
  /** Money cell -> { v: pence, mark } | null (unreadable) | undefined (empty). Accepts 1,234.50  £12.00  (12.00)  12.00-  -12.00  +12.00  12.00 CR/DR. Never accepts other currency symbols or 3 decimals. */
  function money(s, decimalComma) {
    let t = String(s).replace(/ /g, ' ').trim();
    if (t === '') return undefined;
    let neg = false, mark = '';
    t = t.replace(/\s*(CR|DR)$/i, (m, g) => { mark = g.toUpperCase(); return ''; }).trim();
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1).trim(); }
    t = t.replace(/^[+]\s*/, '');
    if (/^[-−–]/.test(t)) { neg = !neg; t = t.slice(1).trim(); }
    if (/[-−–]$/.test(t)) { neg = !neg; t = t.slice(0, -1).trim(); }
    t = t.replace(/^£\s*/, '').replace(/^[-−–]\s*/, (m) => { neg = !neg; return ''; }).replace(/\s/g, '');
    if (decimalComma) t = t.replace(/\./g, '').replace(',', '.');
    if (!(/^\d{1,3}(,\d{3})*(\.\d{1,2})?$/.test(t) || /^\d*\.\d{1,2}$/.test(t) && t !== '.' || /^\d+$/.test(t))) return null;
    const [w, f = ''] = t.replace(/,/g, '').split('.');
    const v = (+w || 0) * 100 + (+((f + '00').slice(0, 2)));
    return { v: neg ? -v : v, mark };
  }

  /** A date cell -> candidates, or null. { y, a, b, fmt:'ymd'|'amb'|'mon'|'serial' } where a/b are the two numbers of an ambiguous pair. */
  function dateCell(s) {
    let t = String(s).trim().replace(/[ T]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/, '').trim();
    let m;
    if ((m = t.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/))) return { fmt: 'ymd', y: +m[1], m: +m[2], d: +m[3] };
    if ((m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?[ \-\/.]([A-Za-z]{3,9})\.?[ \-\/.,]+(\d{4}|\d{2})$/)) && MONTHS[m[2].slice(0, 3).toLowerCase()]) return { fmt: 'mon', y: m[3].length === 2 ? 2000 + +m[3] : +m[3], m: MONTHS[m[2].slice(0, 3).toLowerCase()], d: +m[1] };
    if ((m = t.match(/^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/)) && MONTHS[m[1].slice(0, 3).toLowerCase()]) return { fmt: 'mon', y: +m[3], m: MONTHS[m[1].slice(0, 3).toLowerCase()], d: +m[2] };
    if ((m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})$/))) return { fmt: 'amb', y: m[3].length === 2 ? 2000 + +m[3] : +m[3], a: +m[1], b: +m[2] };
    if (/^\d{5}$/.test(t) && +t > 36000 && +t < 60000) { const d = new Date(Date.UTC(1899, 11, 30) + +t * 86400000); return { fmt: 'serial', y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; }
    return null;
  }
  const validYMD = (y, m, d) => { if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false; const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d; };
  const isoOf = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);

  // ---------------------------------------------------------------- descriptions that hint at the sign convention
  const CREDIT_WORDS = /payment[ -]*(received|thank)|thank you|refund|cashback|interest paid|salary|wages|faster payment in|bank giro credit|\bbgc\b|deposit/i;
  const DEBIT_WORDS = /direct debit|\bdd\b|standing order|card payment|\bpos\b|atm|cash withdrawal|cash machine|bill payment|\bfee\b|charge/i;
  const CARD_HEADERS = /card member|card no|card number|cardholder|appears on your statement|account #/i;
const CARD_H = [[/card member|card no|card number|cardholder|appears on your statement/i, 2], [/merchant (city|county|postal|post code|country)|mcc|sic/i, 2], [/^account #$/i, 1], [/billing amount|billed amount/i, 1], [/merchant/i, 1], [/posting date|posted date/i, 0.5], [/reference number/i, 0.5]];
const CUR_H = [[/sort code/i, 2], [/account number/i, 1], [/paid in|paid out|money in|money out/i, 1.5], [/^(running |account |closing )?balance/i, 1.5], [/cheque|chq/i, 1], [/^type$|transaction type/i, 0.5]];
const CUR_WORDS = /direct debit|standing order|faster payment|\bbacs\b|\bbgc\b|\bdd\b|\bso\b|cash wdl|cash withdrawal|\batm\b|\bfpi\b|\bfpo\b|salary|cheque|bank giro|transfer (to|from)/i;
const CARD_WORDS = /payment received|payment[ -]*thank|thank you|annual fee|late payment|cash advance|foreign (transaction|currency) fee/i;

  // ---------------------------------------------------------------- the reader
  function read(input, name) {
    const notes = [], problems = [];
    const out = { type: 'csv', institution: 'Unknown bank (CSV, auto-detected)', name, notes, problems, txns: [], confidence: 'failed', ok: false };
    const fail = msg => { problems.push(msg); out.confidence = 'failed'; out.ok = false; return out; };
    let text;
    try { text = decode(input); } catch (e) { return fail('The file could not be decoded as text.'); }
    if (!text.trim()) return fail('The file is empty.');
    if (sniff(input) === 'pdf') return fail('This is a PDF, not a CSV.');
    if (text.indexOf('\u0000') >= 0) return fail('This file is not text, so it cannot be a CSV statement.');

    const delim = sniffDelimiter(text);
    const parsed = parseCSV(text, delim);
    if (parsed.unterminatedQuote) return fail('A quoted cell is never closed, so the rows after it cannot be trusted.');
    const rows = parsed.rows;
    const named = findHeader(rows);
    let first = null;
    if (named) { first = interpret(rows, delim, named, name, false); if (!(first.confidence === 'failed' && first.noAmountColumn)) return first; }
    // No usable header names: find the columns from what is IN them (dates, money, text). Arithmetic still has the last word.
    const heads = inferHeads(rows);
    if (!heads.length) return first || fail('No transaction table found (no header row with a date column and amount columns, and the contents do not look like a transaction list).');
    const results = heads.map(h => interpret(rows, delim, h, name, true));
    const verified = results.filter(r => r.confidence === 'verified');
    if (verified.length === 1) return verified[0];
    if (verified.length > 1 || results.length > 1) return fail('The column names are not recognised and the contents do not settle which column is the amount, so nothing was read.');
    return results[0];
  }

  /** Columns found from their contents (used when the header names are missing or unknown). Returns candidate headers; several when roles are ambiguous. */
  function inferHeads(rows) {
    const filled = r => r.filter(c => String(c).trim()).length;
    const s = rows.findIndex(r => filled(r) >= 3 && r.some(c => dateCell(c)));
    if (s < 0) return [];
    const hdr = s > 0 && filled(rows[s - 1]) >= 2 && !rows[s - 1].some(c => dateCell(c)) ? s - 1 : -1;
    const data = []; for (let i = s; i < rows.length && data.length < 300; i++) if (filled(rows[i]) >= 3) data.push(rows[i]);
    if (data.length < 3) return [];
    const width = Math.max(...data.map(r => r.length));
    const moneyLike = c => /\.\d{2}(?!\d)/.test(c) ? money(c, false) != null : /,\d{2}$/.test(c) ? money(c, true) != null : false;
    const st = [];
    for (let j = 0; j < width; j++) {
      const cells = data.map(r => String(r[j] == null ? '' : r[j]).trim()); const ne = cells.filter(Boolean);
      const dates = ne.filter(c => dateCell(c)).length, moneys = ne.filter(c => !dateCell(c) && moneyLike(c)).length;
      st.push({ j, cells, fill: ne.length / data.length, dateFrac: dates / data.length, moneyFrac: ne.length ? moneys / ne.length : 0, len: ne.length ? ne.reduce((a, c) => a + c.length, 0) / ne.length : 0 });
    }
    const dateCol = st.find(c => c.dateFrac >= 0.9); if (!dateCol) return [];
    const mcols = st.filter(c => c.j !== dateCol.j && c.moneyFrac >= 0.9 && c.fill > 0);
    const text = st.filter(c => c.j !== dateCol.j && c.moneyFrac < 0.9 && c.dateFrac < 0.5 && c.fill >= 0.5).sort((a, b) => b.len - a.len)[0];
    const both = (a, b) => a.cells.filter((c, i) => c && b.cells[i]).length / data.length;
    const mk = assign => {
      const roles = new Array(width).fill(null); roles[dateCol.j] = 'date'; if (text) roles[text.j] = 'desc'; Object.entries(assign).forEach(([role, c]) => { roles[c.j] = role; });
      const cells = Array.from({ length: width }, (_, j) => (hdr >= 0 && rows[hdr][j] != null && String(rows[hdr][j]).trim()) ? rows[hdr][j] : 'column ' + (j + 1));
      return { index: hdr, cells, roles, inferred: true };
    };
    if (mcols.length === 1) return [mk({ amt: mcols[0] })];
    if (mcols.length === 2) { const [a, b] = mcols; return both(a, b) < 0.1 ? [mk({ out: a, in: b }), mk({ in: a, out: b })] : [mk({ amt: a, bal: b }), mk({ amt: b, bal: a })]; }
    if (mcols.length === 3) { for (const [a, b, c] of [[0, 1, 2], [0, 2, 1], [1, 2, 0]]) { const x = mcols[a], y = mcols[b], z = mcols[c]; if (both(x, y) < 0.1 && z.fill >= 0.5) return [mk({ out: x, in: y, bal: z }), mk({ in: x, out: y, bal: z })]; } }
    return [];
  }

  /** Credit card or current account? Scored from header words, description wording and the sign convention that fitted. */
  function classifyAccount(headers, data, hyp, balanceProved) {
    let card = 0, cur = 0; const why = [];
    headers.forEach(h => { const t = String(h).trim(); CARD_H.forEach(([re, w]) => { if (re.test(t)) { card += w; why.push('header "' + t + '" is typical of a card'); } }); CUR_H.forEach(([re, w]) => { if (re.test(t)) { cur += w; why.push('header "' + t + '" is typical of a current account'); } }); });
    const n = Math.max(1, data.length);
    const cw = data.filter(r => CUR_WORDS.test(r.desc)).length / n, kw = data.filter(r => CARD_WORDS.test(r.desc)).length;
    if (cw >= 0.05) { cur += 2; why.push('descriptions mention direct debits, standing orders or cash machines'); }
    if (kw >= 1) { card += 2; why.push('a payment-received or card-fee row'); }
    if (hyp && hyp.card) { card += 3; why.push('the amounts only make sense as card spend'); }
    if (balanceProved) { cur += 1; why.push('a running balance that adds up'); }
    const accountType = card - cur >= 2 ? 'card' : cur - card >= 2 ? 'current' : 'unknown';
    return { accountType, accountTypeWhy: why.slice(0, 6), accountTypeScore: { card, current: cur } };
  }

  /** Read one table, given its header (named or inferred). */
  function interpret(rows, delim, head, name, inferred) {
    const notes = [], problems = [];
    const out = { type: 'csv', institution: 'Unknown bank (CSV, auto-detected)', name, notes, problems, txns: [], confidence: 'failed', ok: false };
    const fail = msg => { problems.push(msg); out.confidence = 'failed'; out.ok = false; return out; };
    if (inferred) notes.push('The column names were not recognised, so the columns were found from their contents.');
    const col = {}; const descCols = [];
    head.roles.forEach((r, i) => {
      if (!r) return;
      if (r === 'desc') { descCols.push(i); return; }
      if (r === 'date') { const p = DATE_PRIO[norm(head.cells[i])]; if (col.date == null || p > col.datePrio) { col.date = i; col.datePrio = p; } return; }
      if (col[r] == null) col[r] = i;
    });
    descCols.sort((a, b) => DESC_PRIO.indexOf(norm(head.cells[a])) - DESC_PRIO.indexOf(norm(head.cells[b])));
    const hasAmt = col.amt != null, hasInOut = col.in != null || col.out != null;
    if (!hasAmt && !hasInOut) { out.noAmountColumn = true; return fail('No amount column found.'); }
    out.columns = Object.fromEntries(['date', 'amt', 'in', 'out', 'bal', 'fee', 'state', 'cur'].filter(k => col[k] != null).map(k => [k, head.cells[col[k]].trim()]));
    out.columns.desc = descCols.map(i => head.cells[i].trim());
    const cardHeader = head.cells.some(h => CARD_HEADERS.test(h));

    // decimal comma only when the file never uses a decimal point in its money columns
    const moneyIdx = [col.amt, col.in, col.out, col.bal, col.fee].filter(i => i != null);
    const sample = rows.slice(head.index + 1, head.index + 200).flatMap(r => moneyIdx.map(i => r[i] || ''));
    const decimalComma = delim !== ',' && sample.some(s => /\d,\d{2}(?!\d)/.test(s)) && !sample.some(s => /\d\.\d{2}(?!\d)/.test(s));
    if (decimalComma) notes.push('Amounts use a decimal comma.');

    // pass 1: pull every row's raw pieces
    const raw = []; const skipped = { notTransaction: 0, state: 0, repeatedHeader: 0 };
    const headerKey = head.cells.map(c => c.trim().toLowerCase()).join('|');
    let curSeen = new Set();
    for (let i = head.index + 1; i < rows.length; i++) {
      const r = rows[i]; const filled = r.filter(c => c.trim()).length;
      if (!filled) continue;
      if (r.map(c => c.trim().toLowerCase()).join('|') === headerKey) { skipped.repeatedHeader++; continue; }
      const get = k => col[k] != null ? (r[col[k]] || '') : '';
      if (col.state != null) { const st = get('state').trim().toLowerCase(); if (st && !/^(completed|complete|settled|posted|booked)$/.test(st)) { skipped.state++; continue; } }
      if (col.cur != null) { const c = get('cur').trim().toUpperCase(); if (c) curSeen.add(c); }
      const desc = descCols.map(k => (r[k] || '').trim()).filter((v, ix, a) => v && a.indexOf(v) === ix).join(' ').replace(/\s+/g, ' ');
      const d = dateCell(get('date'));
      const a = hasAmt ? money(get('amt'), decimalComma) : undefined;
      const mi = col.in != null ? money(get('in'), decimalComma) : undefined, mo = col.out != null ? money(get('out'), decimalComma) : undefined;
      const b = col.bal != null ? money(get('bal'), decimalComma) : undefined;
      const f = col.fee != null ? money(get('fee'), decimalComma) : undefined;
      const flagText = col.flag != null ? get('flag').trim().toLowerCase() : '';
      const dir = !flagText ? 0 : /^(credit|cr|c|crd|credited)$/.test(flagText) ? 1 : /^(debit|dr|d|dbt|debited)$/.test(flagText) ? -1 : null;
      if (col.flag != null && flagText && dir === null) return fail(`Row ${i + 1} has a debit/credit marker (${flagText.slice(0, 12)}) that is not understood.`);
      if (!d) {
        const anyMoney = [a, mi, mo].some(x => x && x.v != null);
        if (anyMoney && !/total|balance|brought|carried|opening|closing|summary|statement/i.test(r.join(' '))) return fail(`Row ${i + 1} has an amount but no readable date, so a transaction would be lost.`);
        if (b && /brought|carried|opening|closing|balance/i.test(r.join(' ')) && a == null && mi == null && mo == null) { raw.push({ checkpoint: true, bal: b.v, line: i + 1 }); continue; }
        skipped.notTransaction++; continue;
      }
      if (a === null || mi === null || mo === null || b === null || f === null) return fail(`Row ${i + 1} has an amount that cannot be read as pounds and pence.`);
      if (a === undefined && mi === undefined && mo === undefined) {
        if (b) { raw.push({ checkpoint: true, bal: b.v, line: i + 1, date: d }); continue; }   // "brought forward" style row
        skipped.notTransaction++; continue;
      }
      raw.push({ line: i + 1, d, desc, a, mi, mo, b, f, dir, mark: a && a.mark || mi && mi.mark || mo && mo.mark || '' });
    }
    if (curSeen.size && [...curSeen].some(c => c !== 'GBP')) return fail('This file has amounts in a currency other than pounds, which is not supported.');
    const data = raw.filter(r => !r.checkpoint);
    if (!data.length) return fail('The table has a header but no transactions.');
    if (skipped.notTransaction) notes.push(`${skipped.notTransaction} non-transaction row(s) were ignored (totals, notes or blank lines).`);
    if (skipped.state) notes.push(`${skipped.state} pending, reverted or declined row(s) were ignored.`);
    if (skipped.repeatedHeader) notes.push(`${skipped.repeatedHeader} repeated header row(s) were ignored.`);

    // dates: day-first only. A month-first file is refused; an all-ambiguous one is read day-first but cannot be called verified.
    let ambiguousDates = false;
    const amb = data.filter(r => r.d.fmt === 'amb');
    let dayFirst = true;
    if (amb.length) {
      const dfOk = amb.every(r => validYMD(r.d.y, r.d.b, r.d.a)), mfOk = amb.every(r => validYMD(r.d.y, r.d.a, r.d.b));
      if (!dfOk && !mfOk) return fail('Some dates are not valid day/month/year dates.');
      if (!dfOk && mfOk) return fail('Dates look month-first (for example 07/23/2026), so day and month could be swapped. Not read.');
      if (dfOk && mfOk) {
        const seq = f => data.map(r => r.d.fmt === 'amb' ? f(r.d) : null).filter(x => x != null);
        const mono = a => a.every((v, i) => i === 0 || v >= a[i - 1]) || a.every((v, i) => i === 0 || v <= a[i - 1]);
        const df = seq(d => d.y * 10000 + d.b * 100 + d.a), mf = seq(d => d.y * 10000 + d.a * 100 + d.b);
        const dfMono = mono(df), mfMono = mono(mf);
        if (mfMono && !dfMono) return fail('Dates look month-first, so day and month could be swapped. Not read.');
        if (dfMono && mfMono && amb.some(r => r.d.a !== r.d.b)) ambiguousDates = true;
      }
    }
    for (const r of data) {
      const d = r.d; let y = d.y, m = d.m, dd = d.d;
      if (d.fmt === 'amb') { m = d.b; dd = d.a; }
      if (!validYMD(y, m, dd)) return fail(`Row ${r.line} has a date that does not exist.`);
      r.date = isoOf(y, m, dd);
    }

    // amounts, as printed
    data.forEach(r => {
      if (hasAmt && col.flag != null && col.in == null && col.out == null) { if (!r.dir) { r.printed = null; } else r.printed = r.dir * Math.abs(r.a ? r.a.v : 0); }
      else if (hasAmt) r.printed = r.a ? r.a.v : 0;
      else r.printed = (r.mi ? Math.abs(r.mi.v) : 0) - (r.mo ? Math.abs(r.mo.v) : 0);
      if (r.f && r.f.v) r.printed -= Math.abs(r.f.v);   // a separate fee column also changes the balance
    });
    if (col.flag != null && hasAmt && data.some(r => r.printed === null)) return fail('Some rows have no debit/credit marker, so their direction is unknown.');
    // in/out columns (or a debit/credit flag) state the direction themselves. A lone amount column needs a sign convention.
    const hyps = [];
    if (hasAmt && col.in == null && col.out == null && col.flag == null) {
      hyps.push({ name: 'bank: amounts signed as printed', card: false, f: r => r.mark === 'CR' ? Math.abs(r.printed) : r.mark === 'DR' ? -Math.abs(r.printed) : r.printed });
      hyps.push({ name: 'card: printed amounts are spend, minus or CR is a credit', card: true, f: r => r.mark === 'CR' ? Math.abs(r.printed) : -r.printed });
    } else hyps.push({ name: col.flag != null ? 'direction from the debit/credit marker column' : 'direction from the in/out columns', card: false, f: r => r.printed });
    // Monzo-style files carry the amount AND money in/out: they must agree, which also settles the sign
    let crossChecked = false;
    if (hasAmt && (col.in != null || col.out != null)) {
      const bad = data.filter(r => ((r.mi ? Math.abs(r.mi.v) : 0) - (r.mo ? Math.abs(r.mo.v) : 0)) !== (r.a ? r.a.v : 0) && (r.mi || r.mo)).length;
      if (bad) return fail(`The amount column disagrees with the money in/out columns on ${bad} row(s).`);
      crossChecked = true;
    }

    const hasBal = col.bal != null && raw.some(r => r.bal != null || r.b);
    const ordered = raw.map(r => r.checkpoint ? r : Object.assign(r, { bal: r.b ? r.b.v : null }));
    const chain = (list, f) => { let ok = 0, bad = 0, prev = null, sum = 0, first = null;
      list.forEach(r => { if (r.checkpoint) { if (prev != null && prev + sum === r.bal) ok++; else if (prev != null) bad++; prev = r.bal; sum = 0; return; }
        const amt = f(r);
        if (r.bal == null) { sum += amt; return; }
        if (prev != null) { if (prev + sum + amt === r.bal) ok++; else bad++; }
        prev = r.bal; sum = 0; });
      return { ok, bad }; };
    let best = null;
    hyps.forEach(h => {
      const orders = hasBal ? [['as printed', ordered], ['reversed', ordered.slice().reverse()]] : [['as printed', ordered]];
      orders.forEach(([oname, list]) => {
        const res = hasBal ? chain(list, h.f) : { ok: 0, bad: 0 };
        let score = hasBal ? res.ok * 10 - res.bad * 10 : 0;
        const words = data.reduce((s, r) => { const v = h.f(r); return s + (CREDIT_WORDS.test(r.desc) ? (v > 0 ? 1 : -1) : 0) + (DEBIT_WORDS.test(r.desc) ? (v < 0 ? 1 : -1) : 0); }, 0);
        score += Math.max(-3, Math.min(3, words)) * 0.5 + (h.card && cardHeader ? 2 : 0) + (!h.card && cardHeader ? -2 : 0);
        if (!best || score > best.score) best = { h, res, oname, score };
      });
    });
    const tx = data.map(r => ({ date: r.date, desc: r.desc, amount: best.h.f(r), balance: r.bal, payee: r.desc.slice(0, 40) }));
    out.txns = tx; out.rows = tx.length; out.convention = best.h.name;
    const checks = {}; out.checks = checks;
    if (hasBal && best.res.ok + best.res.bad === 0) {
      // one balance figure and nothing to compare it with: read, but nothing proves it
      out.confidence = 'unverified'; notes.push('The file has a balance column but too few balance figures to check the amounts against each other.');
    } else if (hasBal) {
      checks.chain = best.res.bad === 0 && best.res.ok > 0 ? { ok: true, msg: `running balance adds up across ${best.res.ok} step(s), rows ${best.oname}` } : { ok: false, msg: best.res.ok + best.res.bad === 0 ? 'The balance column has too few figures to check anything.' : `The running balance does not add up on ${best.res.bad} of ${best.res.ok + best.res.bad} step(s).` };
      if (!checks.chain.ok) { out.txns = []; return fail(checks.chain.msg); }
      out.confidence = 'verified'; out.ok = true;
      if (tx.every(t => t.amount === 0)) { out.txns = []; return fail('Every amount read as zero, so the arithmetic proves nothing.'); }
      if (ambiguousDates) { out.confidence = 'unverified'; out.ok = false; notes.push('Every date could be read day-first or month-first and nothing here settles it, so the dates are read day-first and flagged.'); }
    } else {
      out.confidence = 'unverified';
      notes.push('This file has no running balance, so nothing could be used to prove the amounts.');
      if (hyps.length > 1) notes.push('Sign convention guessed from the wording: ' + best.h.name + '.');
      if (crossChecked) notes.push('The amount column agrees with the money in/out columns on every row.');
      if (ambiguousDates) notes.push('Dates could be day-first or month-first; read day-first.');
    }
    // debit/credit marker column: does the printed sign agree with it?
    if (col.flag != null && hasAmt) {
      const withSign = data.filter(r => r.a && r.a.v !== 0 && r.dir);
      const cardLike = withSign.filter(r => Math.sign(r.a.v) === -r.dir).length, bankLike = withSign.filter(r => Math.sign(r.a.v) === r.dir).length;
      if (withSign.length) notes.push(cardLike === withSign.length ? 'Printed amounts follow the card style (spend positive, payments negative) and agree with the debit/credit marker on every row.' : bankLike === withSign.length ? 'Printed amounts follow the bank style (money out negative) and agree with the debit/credit marker on every row.' : 'The printed signs do not all follow one style; the debit/credit marker was used.');
    }
    Object.assign(out, classifyAccount(head.cells, data, best.h, out.confidence === 'verified' && hasBal));
    const ds = tx.map(t => t.date).sort(); out.period = { start: ds[0], end: ds[ds.length - 1] };
    return out;
  }

  const api = { read, sniff, decode, parseCSV, money, dateCell, findHeader, roleOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SmartCSV = api;
})(typeof self !== 'undefined' ? self : this);
