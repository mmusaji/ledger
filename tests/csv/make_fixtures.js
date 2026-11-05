#!/usr/bin/env node
/* Generates synthetic UK-bank-style CSV statements with KNOWN answers, for testing readers/csv.js.
 *   node tests/csv/make_fixtures.js [--out tests/csv/fixtures] [--seed 1] [--profile tests/csv/profile.json]
 * Writes <out>/*.csv and <out>/expected.json. The same seed always gives the same files.
 *
 * Everything is INVENTED (merchants, names, sort codes, balances). The shape of the data (rows per statement, amount sizes,
 * share of money in, rows per day) is taken from tests/csv/profile.json, which holds anonymous numbers learned from real PDFs.
 * The column layouts follow how the major UK banks and card issuers export CSVs (see DIALECTS below).
 *
 * expected.json entry: { expect: 'verified'|'unverified'|'fail', txns: [[date, pence], ...], note, known? }
 *   verified    the file has a running balance, so the reader must prove it AND return exactly these transactions
 *   unverified  no balance to prove it against, so the reader must return exactly these transactions but cannot call it proven
 *   fail        the reader must NOT accept the file (tampered, not UK, not a statement, ...)
 *   known       a documented gap: reported separately and never counted as a failure
 */
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2); const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(opt('--out', path.join(__dirname, 'fixtures'))), SEED = +opt('--seed', 1);
const PROFILE_FILE = opt('--profile', path.join(__dirname, 'profile.json'));
let profile = {}; try { profile = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8')); } catch (e) { /* defaults below */ }

// ---------------------------------------------------------------- seeded random numbers
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rng = mulberry32(SEED);
const ri = (a, b) => a + Math.floor(rng() * (b - a + 1)), pick = a => a[Math.floor(rng() * a.length)];
const pad = n => String(n).padStart(2, '0');

// ---------------------------------------------------------------- invented data, shaped by the profile
const SHOPS = ['Hartley Grocers', 'Northgate Fuel', 'Linden Pharmacy', 'Marlow Bakery', 'Quayside Cafe', 'Redfern Hardware', 'Oakby Books', 'Tilbury Taxis', 'Fenwick Pets', 'Larkfield Cinema', 'Ashgrove Garden Centre', 'Pennant Wines', 'Kestrel Mobile', 'Brightwell Energy', 'Corvin Water', 'Elmhurst Council', 'Harbour Gym', 'Delmont Insurance', 'Westerly Rail', 'Juniper Kids Club'];
const INCOME = ['Brightwell Ltd Salary', 'Easton Freelance Invoice', 'Refund Oakby Books', 'Interest Paid', 'Transfer From Savings', 'Child Benefit'];
const OUTP = ['CARD PAYMENT TO', 'DIRECT DEBIT', 'FASTER PAYMENT TO', 'STANDING ORDER', 'CARD PAYMENT TO', 'CARD PAYMENT TO'];
const DEF_OUT = [120, 260, 410, 650, 899, 1250, 1999, 3150, 5400, 9500, 60000], DEF_IN = [500, 2500, 12000, 45000, 150000, 250000];
const outs = (profile.outDeciles && profile.outDeciles.length ? profile.outDeciles : DEF_OUT), ins = (profile.inDeciles && profile.inDeciles.length ? profile.inDeciles : DEF_IN);
const shareIn = typeof profile.shareIn === 'number' ? Math.min(0.5, Math.max(0.05, profile.shareIn)) : 0.2;
const perDay = Math.max(1, Math.min(4, profile.rowsPerActiveDay || 1.6));
const rowCounts = profile.rowsPerStatement && profile.rowsPerStatement.length ? profile.rowsPerStatement : [12, 25, 40];
const sample = d => { const i = Math.floor(rng() * (d.length - 1)); const lo = d[i], hi = d[i + 1]; return Math.max(1, Math.round((lo + (hi - lo) * rng()) / 1) | 0); };

/** A synthetic account: dates in order, signed pence (spend negative), running balance after each row. */
function makeLedger(o = {}) {
  const n = o.n || Math.min(60, Math.max(6, pick(rowCounts))), start = o.start || { y: 2026, m: ri(1, 9), d: 1 };
  const rows = []; let day = o.firstDay || 1, bal = o.opening != null ? o.opening : ri(50000, 400000);
  const opening = bal;
  while (rows.length < n) {
    const k = Math.min(n - rows.length, rng() < 0.5 ? 1 : ri(1, Math.round(perDay * 2)));
    for (let j = 0; j < k; j++) {
      const credit = rng() < shareIn;
      let amt = credit ? sample(ins) : -sample(outs);
      if (o.small) amt = credit ? 150 + ri(0, 4) * 100 : -(250 + ri(0, 9) * 37);
      const desc = credit ? pick(INCOME) : pick(OUTP) + ' ' + pick(SHOPS).toUpperCase();
      bal += amt; rows.push({ date: { y: start.y, m: start.m, d: Math.min(day, 28) }, desc, amt, bal });
    }
    day += o.dayStep || ri(0, 2) + (n > 28 ? 0 : 1); if (day > 28) day = 28;
  }
  const last = rows[rows.length - 1]; if (!o.keepDays && last.date.d <= 12) last.date.d = ri(20, 28);
  return { opening, rows, start };
}
const clone = L => ({ opening: L.opening, start: L.start, rows: L.rows.map(r => Object.assign({}, r, { date: Object.assign({}, r.date) })) });
const iso = d => d.y + '-' + pad(d.m) + '-' + pad(d.d);

// ---------------------------------------------------------------- how to print dates and money
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DATE = {
  dmy: d => `${pad(d.d)}/${pad(d.m)}/${d.y}`, dmyDash: d => `${pad(d.d)}-${pad(d.m)}-${d.y}`, dmyDot: d => `${pad(d.d)}.${pad(d.m)}.${d.y}`,
  dmy2: d => `${pad(d.d)}/${pad(d.m)}/${String(d.y).slice(2)}`, d_m_y: d => `${d.d}/${d.m}/${d.y}`,
  dMonY: d => `${pad(d.d)} ${MON[d.m - 1]} ${d.y}`, dMonYDash: d => `${pad(d.d)}-${MON[d.m - 1]}-${String(d.y).slice(2)}`, dMonYLong: d => `${d.d} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.m - 1]} ${d.y}`,
  ymd: d => iso(d), isoTime: d => `${iso(d)}T${pad(ri(0, 23))}:${pad(ri(0, 59))}:${pad(ri(0, 59))}Z`, ymdTime: d => `${iso(d)} ${pad(ri(0, 23))}:${pad(ri(0, 59))}:${pad(ri(0, 59))}`,
  serial: d => String(Math.round((Date.UTC(d.y, d.m - 1, d.d) - Date.UTC(1899, 11, 30)) / 86400000)),
  monthFirst: d => `${pad(d.m)}/${pad(d.d)}/${d.y}`,
};
const f2 = p => { const a = Math.abs(p); return Math.floor(a / 100) + '.' + pad(a % 100); };
const thousands = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const MONEY = {
  plain: p => (p < 0 ? '-' : '') + f2(p), pound: p => (p < 0 ? '-' : '') + '£' + f2(p), poundAfter: p => '£' + (p < 0 ? '-' : '') + f2(p),
  comma: p => (p < 0 ? '-' : '') + thousands(f2(p).split('.')[0]) + '.' + f2(p).split('.')[1], poundComma: p => (p < 0 ? '-' : '') + '£' + thousands(f2(p).split('.')[0]) + '.' + f2(p).split('.')[1],
  bracket: p => p < 0 ? '(' + f2(p) + ')' : f2(p), trail: p => p < 0 ? f2(p) + '-' : f2(p), crdr: p => f2(p) + (p < 0 ? 'DR' : 'CR'), plus: p => (p < 0 ? '-' : '+') + f2(p),
  euro: p => (p < 0 ? '-' : '') + thousands(f2(p).split('.')[0]).replace(/,/g, '.') + ',' + f2(p).split('.')[1], spaced: p => (p < 0 ? '- ' : '') + f2(p),
};
const absM = (fn, p) => p ? fn(Math.abs(p)) : '';

// ---------------------------------------------------------------- bank layouts (invented data, real-world shapes)
// cols: header text + a function giving that cell. t = row, c = context { date(d), money(p), absMoney(p), card }
const SC = "'11-22-33", ACC = '40123456';
const DIALECTS = {
  monzo: { bal: false, cols: [['Transaction ID', (t, c, i) => 'tx_' + String(100000 + i)], ['Date', (t, c) => c.date(t.date)], ['Time', () => `${pad(ri(0, 23))}:${pad(ri(0, 59))}:${pad(ri(0, 59))}`], ['Type', t => t.amt < 0 ? 'Card payment' : 'Faster payment'], ['Name', t => t.desc.replace(/^[A-Z ]+ TO /, '')], ['Emoji', () => ''], ['Category', () => 'General'], ['Amount', (t, c) => c.money(t.amt)], ['Currency', () => 'GBP'], ['Local amount', (t, c) => c.money(t.amt)], ['Local currency', () => 'GBP'], ['Notes and #tags', () => ''], ['Address', () => ''], ['Receipt', () => ''], ['Description', t => t.desc], ['Category split', () => ''], ['Money Out', (t, c) => t.amt < 0 ? c.money(t.amt) : ''], ['Money In', (t, c) => t.amt > 0 ? c.money(t.amt) : '']] },
  monzo_slim: { bal: false, cols: [['Transaction ID', (t, c, i) => 'tx_' + (200000 + i)], ['Date', (t, c) => c.date(t.date)], ['Time', () => '09:30:00'], ['Type', () => 'Card payment'], ['Name', t => t.desc], ['Category', () => 'Eating out'], ['Amount', (t, c) => c.money(t.amt)], ['Currency', () => 'GBP'], ['Notes and #tags', () => ''], ['Description', t => t.desc]] },
  barclays_signed: { bal: false, newestFirst: true, cols: [['Number', (t, c, i) => i + 1], ['Date', (t, c) => c.date(t.date)], ['Account', () => `${SC.slice(1)} ${ACC}`], ['Amount', (t, c) => c.money(t.amt)], ['Subcategory', () => 'GENERAL'], ['Memo', t => t.desc]] },
  barclays_inout: { bal: false, cols: [['Date', (t, c) => c.date(t.date)], ['Description', t => t.desc], ['Money out', (t, c) => t.amt < 0 ? c.absMoney(-t.amt) : ''], ['Money in', (t, c) => t.amt > 0 ? c.absMoney(t.amt) : '']] },
  barclays_inout_bal: { bal: true, cols: [['Date', (t, c) => c.date(t.date)], ['Description', t => t.desc], ['Money out', (t, c) => t.amt < 0 ? c.absMoney(-t.amt) : ''], ['Money in', (t, c) => t.amt > 0 ? c.absMoney(t.amt) : ''], ['Balance', (t, c) => c.money(t.bal)]] },
  lloyds: { bal: true, cols: [['Transaction Date', (t, c) => c.date(t.date)], ['Transaction Type', t => t.amt < 0 ? 'DEB' : 'FPI'], ['Sort Code', () => SC], ['Account Number', () => ACC], ['Transaction Description', t => t.desc], ['Debit Amount', (t, c) => t.amt < 0 ? c.absMoney(-t.amt) : ''], ['Credit Amount', (t, c) => t.amt > 0 ? c.absMoney(t.amt) : ''], ['Balance', (t, c) => c.money(t.bal)]] },
  nationwide: { bal: true, preamble: L => [['Account Name:', 'Example Current Account'], ['Account Balance:', '£' + thousands(f2(L.rows[L.rows.length - 1].bal))], ['Available Balance:', '£' + thousands(f2(L.rows[L.rows.length - 1].bal))], []], cols: [['Date', (t, c) => c.date(t.date)], ['Transaction type', t => t.amt < 0 ? 'Debit' : 'Credit'], ['Description', t => t.desc], ['Paid out', (t, c) => t.amt < 0 ? c.absMoney(-t.amt) : ''], ['Paid in', (t, c) => t.amt > 0 ? c.absMoney(t.amt) : ''], ['Balance', (t, c) => c.money(t.bal)]], dateFmt: 'dMonY', money: 'poundComma' },
  hsbc: { bal: false, cols: [['Date', (t, c) => c.date(t.date)], ['Description', t => t.desc], ['Amount', (t, c) => c.money(t.amt)]] },
  first_direct: { bal: false, newestFirst: true, cols: [['Date', (t, c) => c.date(t.date)], ['Description', t => t.desc], ['Amount', (t, c) => c.money(t.amt)]], money: 'comma' },
  natwest: { bal: true, cols: [['Date', (t, c) => c.date(t.date)], ['Type', t => t.amt < 0 ? 'POS' : 'BAC'], ['Description', t => t.desc], ['Value', (t, c) => c.money(t.amt)], ['Balance', (t, c) => c.money(t.bal)], ['Account Name', () => 'EXAMPLE CURRENT'], ['Account Number', () => "'" + ACC]] },
  santander: { bal: true, preamble: L => [['From: ' + DATE.dmy(L.rows[0].date) + ' to ' + DATE.dmy(L.rows[L.rows.length - 1].date)], ['Account name: Example Account'], []], cols: [['Date', (t, c) => c.date(t.date)], ['Description', t => t.desc], ['Amount', (t, c) => c.money(t.amt)], ['Balance', (t, c) => c.money(t.bal)]], money: 'pound' },
  starling: { bal: true, cols: [['Date', (t, c) => c.date(t.date)], ['Counter Party', t => t.desc.replace(/^[A-Z ]+ TO /, '')], ['Reference', t => t.amt < 0 ? 'Card' : 'Payment'], ['Type', () => 'FASTER PAYMENT'], ['Amount (GBP)', (t, c) => c.money(t.amt)], ['Balance (GBP)', (t, c) => c.money(t.bal)], ['Spending Category', () => 'GENERAL'], ['Notes', () => '']] },
  revolut: { bal: true, cols: [['Type', t => t.amt < 0 ? 'CARD_PAYMENT' : 'TOPUP'], ['Product', () => 'Current'], ['Started Date', (t, c) => c.date(t.date, 'ymdTime')], ['Completed Date', (t, c) => c.date(t.date, 'ymdTime')], ['Description', t => t.desc], ['Amount', (t, c) => c.money(t.fee ? t.amt + t.fee : t.amt)], ['Fee', (t, c) => c.money(t.fee || 0)], ['Currency', () => 'GBP'], ['State', () => 'COMPLETED'], ['Balance', (t, c) => c.money(t.bal)]], dateFmt: 'ymdTime' },
  amex: { bal: false, card: true, newestFirst: true, cols: [['Date', (t, c) => c.date(t.date)], ['Description', t => t.desc], ['Card Member', () => 'A EXAMPLE'], ['Account #', () => '-12345'], ['Amount', (t, c) => c.money(-t.amt)]] },
  capital_one: { bal: false, card: true, cols: [['Transaction Date', (t, c) => c.date(t.date)], ['Posted Date', (t, c) => c.date(t.date)], ['Card No.', () => '1234'], ['Description', t => t.desc], ['Category', () => 'Merchandise'], ['Debit', (t, c) => t.amt < 0 ? c.absMoney(-t.amt) : ''], ['Credit', (t, c) => t.amt > 0 ? c.absMoney(t.amt) : '']], dateFmt: 'ymd' },
  card_positive: { bal: false, card: true, cols: [['Date', (t, c) => c.date(t.date)], ['Description', t => t.desc], ['Amount', (t, c) => c.money(-t.amt)]] },
  generic_bal: { bal: true, cols: [['Date', (t, c) => c.date(t.date)], ['Description', t => t.desc], ['Amount', (t, c) => c.money(t.amt)], ['Balance', (t, c) => c.money(t.bal)]] },
};
const BAL_DIALECTS = Object.keys(DIALECTS).filter(k => DIALECTS[k].bal), NOBAL_DIALECTS = Object.keys(DIALECTS).filter(k => !DIALECTS[k].bal);

// ---------------------------------------------------------------- turn a ledger into file bytes
function csvLine(cells, delim, quoteAll) {
  return cells.map(c => { const s = String(c == null ? '' : c); return quoteAll || /[",\n\r]/.test(s) || s.includes(delim) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(delim);
}
/** build(dialect name, ledger, options) -> { bytes, truth } */
function build(dname, L, o = {}) {
  const D = DIALECTS[dname]; L = clone(L);
  const dateKey = o.dateFmt || D.dateFmt || 'dmy', moneyKey = o.money || D.money || 'plain';
  const ctx = { date: (d, k) => DATE[o.dateFmt || k || dateKey](d), money: p => MONEY[moneyKey](p), absMoney: p => (['bracket', 'trail', 'crdr', 'plus'].includes(moneyKey) ? MONEY.plain : MONEY[moneyKey])(Math.abs(p)) };
  if (o.mutate) o.mutate(L);
  const truth = L.rows.filter(r => !r.ghost).map(r => [iso(r.date), r.amt]);
  let rows = L.rows.slice();
  const newest = o.newestFirst != null ? o.newestFirst : !!D.newestFirst;
  if (newest) rows = rows.reverse();
  let header = D.cols.map(c => c[0]), colIdx = D.cols.map((c, i) => i);
  if (o.shuffleCols) colIdx = colIdx.map(i => [rng(), i]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  if (o.dropCols) colIdx = colIdx.filter(i => !o.dropCols.includes(D.cols[i][0]));
  const extra = o.extraCols ? ['Spare One', 'Spare Two'] : [];
  const cell = (r, i, n) => { const v = D.cols[i][1](r, ctx, n); return o.padCells ? ' ' + v + ' ' : v; };
  const lines = [];
  const delim = o.delim || ',';
  const emit = cells => { const row = o.trailDelim ? cells.concat(['']) : cells; lines.push(csvLine(row, delim, o.quoteAll)); };
  if (!o.noPreamble && D.preamble) D.preamble(L).forEach(r => emit(r));
  if (o.preambleN) for (let k = 0; k < o.preambleN; k++) emit(k % 3 === 0 ? ['Statement for account ' + ACC] : k % 3 === 1 ? ['Generated on 05/11/2026'] : []);
  const hdrText = h => o.headerCase === 'upper' ? h.toUpperCase() : o.headerCase === 'lower' ? h.toLowerCase() : o.headerCase === 'spaced' ? '  ' + h + '  ' : h;
  if (!o.noHeader) emit(colIdx.map(i => hdrText(header[i])).concat(extra));
  rows.forEach((r, n) => {
    if (o.ghostRows && o.ghostRows[n]) { colIdx.length; emit(o.ghostRows[n]); }
    emit(colIdx.map(i => cell(r, i, n)).concat(extra.map(() => 'x')));
    if (o.blankEvery && (n + 1) % o.blankEvery === 0) lines.push('');
    if (o.repeatHeaderAt != null && n === o.repeatHeaderAt) emit(colIdx.map(i => hdrText(header[i])).concat(extra));
  });
  if (o.footer) { const cells = colIdx.map(i => ''); cells[0] = 'Total'; const ai = colIdx.findIndex(i => /Amount|Value/.test(header[i])); if (ai >= 0) cells[ai] = MONEY.plain(L.rows.reduce((s, r) => s + r.amt, 0)); emit(cells); lines.push(''); lines.push('Generated by Example Bank'); }
  if (o.rawAppend) lines.push(o.rawAppend);
  let text = lines.join(o.eol || '\n') + (o.noFinalEol ? '' : (o.eol || '\n'));
  if (o.transformText) text = o.transformText(text);
  let bytes;
  if (o.encoding === 'latin1') bytes = Buffer.from(text, 'latin1');
  else if (o.encoding === 'utf16le') bytes = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')]);
  else bytes = Buffer.from((o.bom ? '﻿' : '') + text, 'utf8');
  return { bytes, truth };
}

// ---------------------------------------------------------------- the fixture list
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const expected = {}; let count = 0;
function add(id, bytes, exp) { fs.writeFileSync(path.join(OUT, id + '.csv'), bytes); expected[id] = exp; count++; }
function ok(id, dname, L, o = {}, note) {
  const { bytes, truth } = build(dname, L, o); const D = DIALECTS[dname];
  let balanced = D.bal && !(o.dropCols && o.dropCols.includes('Balance'));
  const fmt = o.dateFmt || D.dateFmt || 'dmy';
  const ambiguous = ['dmy', 'dmyDash', 'dmyDot', 'dmy2', 'd_m_y'].includes(fmt) && truth.every(t => +t[0].slice(8) <= 12) && truth.some(t => +t[0].slice(8) !== +t[0].slice(5, 7));
  if (ambiguous && balanced) { balanced = false; note = (note ? note + '; ' : '') + 'every date could be day-first or month-first, so it cannot be called verified'; }
  add(id, bytes, { expect: balanced ? 'verified' : 'unverified', txns: truth, note: note || '' });
}
function bad(id, dname, L, o, note, known) { const { bytes } = build(dname, L, o); add(id, bytes, { expect: 'fail', note, known: known || undefined }); }
const base = () => makeLedger();

// 1. every layout, plain
Object.keys(DIALECTS).forEach(d => { if (d !== 'hsbc') ok(`layout_${d}`, d, base()); });
ok('layout_hsbc_with_header', 'hsbc', base());
bad('known_hsbc_no_header_row', 'hsbc', base(), { noHeader: true }, 'Some banks export no header row at all. Columns cannot be mapped by name, so this is refused today.', true);

// 2. formatting variations: each is applied to one layout WITH a running balance and one WITHOUT, answers unchanged
const VARIATIONS = {
  bom: { bom: true }, crlf: { eol: '\r\n' }, cr_only: { eol: '\r' }, no_final_newline: { noFinalEol: true }, quote_all: { quoteAll: true }, trailing_delimiter: { trailDelim: true },
  blank_lines: { blankEvery: 3 }, footer_totals: { footer: true }, repeated_header: { repeatHeaderAt: 7 }, reversed_order: { newestFirst: 'flip' }, padded_cells: { padCells: true },
  header_upper: { headerCase: 'upper' }, header_lower: { headerCase: 'lower' }, header_spaced: { headerCase: 'spaced' }, extra_columns: { extraCols: true }, shuffled_columns: { shuffleCols: true },
  preamble_lines: { preambleN: 7 },
  date_dash: { dateFmt: 'dmyDash' }, date_dot: { dateFmt: 'dmyDot' }, date_short_year: { dateFmt: 'dmy2' }, date_no_padding: { dateFmt: 'd_m_y' }, date_day_mon_year: { dateFmt: 'dMonY' },
  date_dash_mon: { dateFmt: 'dMonYDash' }, date_long_month: { dateFmt: 'dMonYLong' }, date_iso: { dateFmt: 'ymd' }, date_iso_time: { dateFmt: 'isoTime' }, date_excel_serial: { dateFmt: 'serial' },
  money_pound: { money: 'pound' }, money_pound_after_minus: { money: 'poundAfter' }, money_thousands: { money: 'comma' }, money_pound_thousands: { money: 'poundComma' },
  money_brackets: { money: 'bracket' }, money_trailing_minus: { money: 'trail' }, money_plus_prefix: { money: 'plus' }, money_spaced_minus: { money: 'spaced' },
  latin1: { encoding: 'latin1', money: 'pound' }, utf16: { encoding: 'utf16le', money: 'pound' }, semicolon_decimal_comma: { delim: ';', money: 'euro' }, tab_separated: { delim: '\t' },
};
const pairs = [['lloyds', 'monzo'], ['nationwide', 'barclays_signed'], ['natwest', 'hsbc'], ['starling', 'first_direct'], ['santander', 'barclays_inout'], ['barclays_inout_bal', 'capital_one'], ['generic_bal', 'monzo_slim'], ['revolut', 'amex']];
Object.entries(VARIATIONS).forEach(([vn, o], i) => {
  const [withBal, noBal] = pairs[i % pairs.length];
  [withBal, noBal].forEach(d => {
    const oo = Object.assign({}, o); if (oo.newestFirst === 'flip') oo.newestFirst = !DIALECTS[d].newestFirst;
    if (vn === 'money_brackets' || vn === 'money_trailing_minus' || vn === 'money_plus_prefix') { /* these apply to the signed amount column only */ }
    const dd = (vn.startsWith('money_') && !DIALECTS[d].cols.some(c => /^(Amount|Value|Amount \(GBP\)|Balance)$/.test(c[0]))) ? (DIALECTS[d].bal ? 'generic_bal' : 'hsbc') : d;
    ok(`var_${vn}__${dd}`, dd, base(), oo);
  });
});

// 3. wording inside the cells (answers unchanged)
const strange = (id, dname, fn, note) => { const L = base(); L.rows.forEach((r, i) => { if (i % 4 === 1) r.desc = fn(r.desc, i); }); ok(id, dname, L, {}, note); };
['generic_bal', 'hsbc'].forEach(d => {
  strange(`text_commas_and_quotes__${d}`, d, s => `${s}, "BRANCH" 12, HIGH ST`);
  strange(`text_newline_inside_quotes__${d}`, d, s => `${s}\nREF 12345`);
  strange(`text_unicode__${d}`, d, s => `${s} Café Münster ☕ 東京`);
  strange(`text_very_long__${d}`, d, s => `${s} ${'LONG REFERENCE '.repeat(40)}`);
  strange(`text_empty__${d}`, d, () => '');
  strange(`text_formula_like__${d}`, d, (s, i) => pick(['=HYPERLINK("http://example.invalid","x")', '+441234567890', '@SUM(A1:A9)', '-2+3', '=cmd|"/c calc"!A0']) + ' ' + s, 'cells starting with = + - @ must stay plain text');
  strange(`text_looks_like_a_date_or_amount__${d}`, d, s => `${s} 12/11/2026 £12.34`, 'descriptions that contain dates and money must not be mistaken for them');
});

// 4. shapes of data
ok('shape_single_row__generic_bal', 'generic_bal', makeLedger({ n: 1 }));
expected['shape_single_row__generic_bal'].expect = 'unverified'; expected['shape_single_row__generic_bal'].note = 'one balance figure: nothing to compare it with, so read but not proven';
ok('shape_two_rows__lloyds', 'lloyds', makeLedger({ n: 2 }));
ok('shape_single_row__hsbc', 'hsbc', makeLedger({ n: 1 }));
ok('shape_many_same_day__generic_bal', 'generic_bal', makeLedger({ n: 30, dayStep: 0 }));
ok('shape_many_same_day__monzo', 'monzo', makeLedger({ n: 30, dayStep: 0 }));
ok('shape_overdrawn__lloyds', 'lloyds', makeLedger({ opening: 5000, n: 20 }), {}, 'balance goes negative');
ok('shape_thousands_amounts__natwest', 'natwest', makeLedger({ opening: 2500000 }), { money: 'comma' });
ok('shape_duplicate_identical_rows__generic_bal', 'generic_bal', (() => { const L = makeLedger({ n: 6, small: true }); const r = L.rows[2]; const dup = Object.assign({}, r, { date: Object.assign({}, r.date), bal: r.bal + r.amt }); L.rows.splice(3, 0, dup); for (let i = 4; i < L.rows.length; i++) L.rows[i].bal += r.amt; return L; })(), {}, 'two identical genuine rows in a row must both be kept');
ok('shape_zero_amount_rows__generic_bal', 'generic_bal', (() => { const L = makeLedger({ n: 10 }); L.rows[4].amt = 0; L.rows[4].bal = L.rows[3].bal; for (let i = 5; i < L.rows.length; i++) L.rows[i].bal = L.rows[i - 1].bal + L.rows[i].amt; return L; })());
ok('shape_stress_5000_rows__generic_bal', 'generic_bal', makeLedger({ n: 5000, dayStep: 0, small: true }), {}, 'speed test: must read in well under a few seconds');
ok('shape_stress_5000_rows__monzo', 'monzo', makeLedger({ n: 5000, dayStep: 0, small: true }));
ok('shape_two_statements_joined__generic_bal', 'generic_bal', makeLedger({ n: 20 }), { repeatHeaderAt: 9 }, 'two exports pasted together, header repeated in the middle');
ok('shape_pending_and_reverted_rows__revolut', 'revolut', makeLedger(), { ghostRows: { 3: ['CARD_PAYMENT', 'Current', '2026-10-02 10:00:00', '', 'PENDING SHOP', '-5.00', '0.00', 'GBP', 'PENDING', ''], 6: ['CARD_PAYMENT', 'Current', '2026-10-03 10:00:00', '2026-10-03 10:05:00', 'REVERTED SHOP', '-7.00', '0.00', 'GBP', 'REVERTED', ''] } }, 'pending and reverted rows never change the balance');
ok('shape_fee_column__revolut', 'revolut', (() => { const L = makeLedger({ n: 14 }); let run = L.opening; L.rows.forEach((r, i) => { if (r.amt < 0 && i % 3 === 0) { r.fee = 50; r.amt -= 50; } run += r.amt; r.bal = run; }); return L; })(), {}, 'amount and fee are separate columns; the balance moves by both');
ok('shape_balance_only_on_last_row_of_day__generic_bal', 'generic_bal', (() => { const L = makeLedger({ n: 16 }); return L; })(), { transformText: t => { const ls = t.split('\n'); let lastDate = null; for (let i = ls.length - 2; i >= 1; i--) { const c = ls[i].split(','); const k = c[0]; if (k === lastDate) { c[c.length - 1] = ''; ls[i] = c.join(','); } lastDate = k; } return ls.join('\n'); } }, 'balance printed only on the last row of each day');
ok('shape_ambiguous_dates_day_first__lloyds', 'lloyds', makeLedger({ n: 6, firstDay: 1, dayStep: 1, keepDays: true, start: { y: 2026, m: 3, d: 1 } }), {}, 'every day and month is 12 or less, so it could be read either way: read day-first but never "verified"');

// 5. cards: signs
ok('card_spend_positive_with_payment_row__card_positive', 'card_positive', (() => { const L = makeLedger({ n: 18 }); L.rows[5].desc = 'PAYMENT RECEIVED - THANK YOU'; L.rows[5].amt = 25000; let run = L.opening; L.rows.forEach(r => { run += r.amt; r.bal = run; }); return L; })());
ok('card_amex_with_member_columns__amex', 'amex', makeLedger());
ok('card_debit_credit_columns__capital_one', 'capital_one', makeLedger());

// 5b. sign convention with no balance to prove it
ok('sign_savings_mostly_credits__hsbc', 'hsbc', (() => { const L = makeLedger({ n: 16 }); let run = L.opening; L.rows.forEach((r, i) => { if (i % 4 !== 0) { r.amt = Math.abs(r.amt); r.desc = 'Transfer In ' + r.desc.split(' ').slice(-1)[0]; } run += r.amt; r.bal = run; }); return L; })(), {}, 'a savings-type file where most rows are money in');
(() => { const L = makeLedger({ n: 14 }); L.rows.forEach(r => { if (r.amt > 0) r.amt = -r.amt; r.desc = pick(SHOPS).toUpperCase(); });
  const { bytes, truth } = build('card_positive', L, {}); add('known_card_spend_only_no_hints__card_positive', bytes, { expect: 'unverified', txns: truth, known: 'A card CSV with only spend, no balance, no payment row and no card wording looks exactly like a bank CSV with every amount positive. The sign cannot be proven.' }); })();

// 6. files that must be REFUSED (a wrong answer here is the worst outcome)
const BALD = ['lloyds', 'natwest', 'starling', 'nationwide', 'revolut', 'santander', 'generic_bal', 'barclays_inout_bal'];
const middle = L => Math.floor(L.rows.length / 2);
BALD.forEach((d, i) => {
  const mk = () => makeLedger({ n: 18 });
  bad(`tamper_amount_changed_by_1p__${d}`, d, mk(), { mutate: L => { L.rows[middle(L)].amt += 1; L.rows.forEach((r, k) => { if (k > middle(L)) r.bal = r.bal; }); } }, 'one amount differs by a penny, the balance does not move');
  bad(`tamper_digits_swapped__${d}`, d, mk(), { mutate: L => { const r = L.rows[middle(L)]; const s = f2(r.amt).replace('.', ''); const sw = s.length > 2 ? s.slice(0, -2) + s[s.length - 1] + s[s.length - 2] : s; if (sw !== s) r.amt = (r.amt < 0 ? -1 : 1) * (+sw); else r.amt += 10; } }, 'two digits of an amount swapped');
  bad(`tamper_row_dropped__${d}`, d, mk(), { mutate: L => { L.rows.splice(middle(L), 1); } }, 'a transaction row is missing');
  bad(`tamper_row_duplicated__${d}`, d, mk(), { mutate: L => { const r = L.rows[middle(L)]; L.rows.splice(middle(L), 0, Object.assign({}, r, { date: Object.assign({}, r.date) })); } }, 'a row appears twice but the balance was not adjusted');
  bad(`tamper_balance_changed__${d}`, d, mk(), { mutate: L => { L.rows[middle(L)].bal += 100; } }, 'a printed balance was edited');
  bad(`tamper_sign_flipped__${d}`, d, mk(), { mutate: L => { L.rows[middle(L)].amt = -L.rows[middle(L)].amt; } }, 'one amount has the wrong sign');
  bad(`tamper_rows_swapped__${d}`, d, mk(), { mutate: L => { const k = middle(L); const t = L.rows[k]; L.rows[k] = L.rows[k + 1]; L.rows[k + 1] = t; } }, 'two neighbouring rows swapped');
});
bad('tamper_first_row_amount__lloyds_KNOWN', 'lloyds', makeLedger({ n: 12 }), { mutate: L => { L.rows[0].amt += 500; } }, 'The first row has no earlier balance to be checked against, so an edit there cannot be caught by arithmetic alone.', true);
bad('refuse_month_first_dates__lloyds', 'lloyds', makeLedger({ n: 15, dayStep: 3 }), { dateFmt: 'monthFirst' }, 'dates written month/day/year: day and month could be swapped');
bad('refuse_month_first_dates__hsbc', 'hsbc', makeLedger({ n: 15, dayStep: 3 }), { dateFmt: 'monthFirst' });
bad('refuse_all_zero_placeholder__generic_bal', 'generic_bal', (() => { const L = makeLedger({ n: 8 }); L.rows.forEach(r => { r.amt = 0; r.bal = L.opening; }); return L; })(), {}, 'a blank template: every amount 0.00');
bad('refuse_dollars__generic_bal', 'generic_bal', makeLedger({ n: 10 }), { transformText: t => t.replace(/(-?)(\d+\.\d\d)/g, '$1$$$2') }, 'dollar amounts');
bad('refuse_euro_symbol__generic_bal', 'generic_bal', makeLedger({ n: 10 }), { transformText: t => t.replace(/(-?)(\d+\.\d\d)/g, '$1€$2') }, 'euro amounts');
bad('refuse_three_decimals__generic_bal', 'generic_bal', makeLedger({ n: 10 }), { transformText: t => t.replace(/(\d+\.\d\d)\b/, '$1' + '5') }, 'an amount with three decimals');
bad('refuse_text_in_amount_cell__generic_bal', 'generic_bal', makeLedger({ n: 10 }), { transformText: t => t.replace(/(-?\d+\.\d\d)(,)/, 'TBC$2') }, 'a word where an amount should be');
bad('refuse_formula_in_amount_cell__generic_bal', 'generic_bal', makeLedger({ n: 10 }), { transformText: t => t.replace(/(-?\d+\.\d\d)(,)/, '=1+1$2') }, 'a formula where an amount should be');
bad('refuse_mixed_currency__revolut', 'revolut', makeLedger({ n: 10 }), { transformText: t => t.replace('GBP', 'USD') }, 'one row in another currency');
bad('refuse_impossible_date__generic_bal', 'generic_bal', makeLedger({ n: 10, dayStep: 2 }), { transformText: t => t.replace(/\d\d\/(\d\d)\/2026/, '31/02/2026') }, '31 February');
bad('refuse_amount_row_without_date__generic_bal', 'generic_bal', makeLedger({ n: 10 }), { transformText: t => t.replace(/\n\d\d\/\d\d\/2026,/, '\n,') }, 'a row has an amount but its date is blank: a transaction would be lost');
bad('refuse_unclosed_quote__generic_bal', 'generic_bal', makeLedger({ n: 10 }), { rawAppend: '01/01/2026,"UNCLOSED,5.00,100.00' }, 'a quote that never closes');
bad('refuse_header_only__generic_bal', 'generic_bal', makeLedger({ n: 1 }), { transformText: t => t.split('\n')[0] + '\n' }, 'a header and no transactions');
bad('refuse_no_header_unknown_columns', 'generic_bal', makeLedger({ n: 8 }), { transformText: t => t.replace(/^.*\n/, 'Col A,Col B,Col C,Col D\n') }, 'headers it does not recognise');
add('refuse_empty_file', Buffer.from(''), { expect: 'fail', note: 'an empty file' });
add('refuse_whitespace_only', Buffer.from('\n \n\t\n'), { expect: 'fail', note: 'only whitespace' });
add('refuse_pdf_renamed_csv', Buffer.concat([Buffer.from('%PDF-1.4\n%'), Buffer.from([0xE2, 0xE3, 0xCF, 0xD3, 0x00, 0x01, 0x02]), Buffer.from('\n1 0 obj\n<< /Type /Catalog >>\nendobj\n')]), { expect: 'fail', note: 'a PDF with the wrong extension' });
add('refuse_binary_garbage', Buffer.from(Array.from({ length: 4000 }, () => ri(0, 255))), { expect: 'fail', note: 'random bytes' });
add('refuse_html_page', Buffer.from('<html><body><table><tr><td>Date</td><td>Amount</td></tr></table></body></html>'), { expect: 'fail', note: 'a web page saved as .csv' });
add('refuse_json_file', Buffer.from('{"date":"2026-01-02","amount":-12.34}'), { expect: 'fail', note: 'JSON, not CSV' });
bad('refuse_signed_balance_does_not_chain__shuffled_rows', 'generic_bal', makeLedger({ n: 20 }), { mutate: L => { L.rows = L.rows.map(r => [rng(), r]).sort((a, b) => a[0] - b[0]).map(x => x[1]); } }, 'rows in random order');

fs.writeFileSync(path.join(OUT, 'expected.json'), JSON.stringify(expected, null, 1));
const tally = {}; Object.values(expected).forEach(e => { const k = e.known ? 'known gap' : e.expect; tally[k] = (tally[k] || 0) + 1; });
console.log(`Wrote ${count} CSV files to ${OUT} (seed ${SEED}).`, JSON.stringify(tally));
if (profile.statementsUsed) console.log(`Shapes taken from ${profile.statementsUsed} real statement(s) (profile.json, anonymous numbers only).`); else console.log('No profile.json found: used built-in default shapes.');
