// Import pipeline (js/pipeline.js): routing by bytes, outcomes, nothing kept for files that fail, and that CSVs never reach the figures.
// Everything here is invented. Run: node tests/pipeline.test.js
const path = require('path'), fs = require('fs');
const root = path.resolve(__dirname, '..');
const CSVR = require(path.join(root, 'readers/csv.js'));
const RD = require(path.join(root, 'readers.js'));
let fail = 0, n = 0; const ok = (c, m) => { n++; if (!c) { fail++; console.log('FAIL', m); } };
const buf = s => new TextEncoder().encode(s).buffer;
const file = (name, content) => ({ name, arrayBuffer: async () => (typeof content === 'string' ? buf(content) : content) });
const BANK = 'Date,Description,Amount,Balance\n13/03/2026,SHOP ONE,-10.00,90.00\n14/03/2026,EMPLOYER PAY,100.00,190.00\n15/03/2026,CAFE TWO,-5.00,185.00\n16/03/2026,SHOP THREE,-20.00,165.00\n';
const TAMPERED = BANK.replace('185.00', '195.00');
const NOBAL = 'Date,Description,Amount\n13/03/2026,SHOP ONE,-10.00\n14/03/2026,EMPLOYER PAY,100.00\n15/03/2026,CAFE TWO,-5.00\n';
const PDFHEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x31, 0x20, 0x30]).buffer;

(async () => {
  const PL = await import(path.join(root, 'js/pipeline.js'));
  const mk = (extra = {}) => Object.assign({ files: {}, ignored: [], version: 3, CSVR, RD, extractPages: async () => [[]] }, extra);

  // ---- routing is by what is inside, not by the name
  ok(PL.kindOf(buf(BANK), CSVR) === 'csv', 'csv bytes -> csv');
  ok(PL.kindOf(PDFHEAD, CSVR) === 'pdf', 'pdf bytes -> pdf');
  ok(PL.kindOf(new Uint8Array([0, 1, 2, 3, 250, 251, 0, 9]).buffer, CSVR) === 'unknown', 'binary -> unknown');
  { const o = await PL.readOne(file('statement.pdf', BANK), mk()); ok(o.kind === 'csv' && o.status === 'added', 'a CSV named .pdf is read as a CSV'); }
  { const o = await PL.readOne(file('statement.csv', PDFHEAD), mk({ RD: { readStatement: () => ({ type: 'unsupported', problems: ['x'] }) } })); ok(o.kind === 'pdf' && o.status === 'failed', 'a PDF named .csv is routed as a PDF'); }

  // ---- CSV outcomes
  const good = await PL.readOne(file('a.csv', BANK), mk());
  ok(good.status === 'added' && good.mark === '✓' && good.rows === 4, 'balance CSV: added, checked, 4 rows');
  ok(good.entry.result.type === 'csv' && good.entry.result.ok === true && good.entry.v === 3, 'entry has the saved shape');
  ok(good.id.startsWith('local:') && good.entry.result.account.id === 'csvfile:' + good.id.slice(6), 'each CSV file gets its own account placeholder');
  const nb = await PL.readOne(file('b.csv', NOBAL), mk());
  ok(nb.status === 'added' && nb.mark === '○' && nb.entry.result.ok === false, 'no-balance CSV: added but marked not checked');
  const bad = await PL.readOne(file('c.csv', TAMPERED), mk());
  ok(bad.status === 'failed' && !bad.entry && bad.why && bad.hint, 'a CSV whose balances do not add up fails and keeps nothing');
  const junk = await PL.readOne(file('d.csv', new Uint8Array([0, 1, 2, 3, 250, 251, 0, 9]).buffer), mk());
  ok(junk.status === 'failed' && /not a PDF or a CSV/.test(junk.why), 'binary junk fails with a plain reason');
  const html = await PL.readOne(file('e.csv', '<html><body>hello</body></html>'), mk());
  ok(html.status === 'failed' && !html.entry, 'an HTML page is refused');

  // ---- known / ignored
  const ctx = mk(); const first = await PL.readOne(file('a.csv', BANK), ctx); ctx.files[first.id] = first.entry;
  ok((await PL.readOne(file('copy of a.csv', BANK), ctx)).status === 'known', 'same bytes again are recognised, whatever the name');
  ctx.files[first.id].v = 2; ok((await PL.readOne(file('a.csv', BANK), ctx)).status === 'added', 'an older parser version is read again');
  ctx.ignored.push(first.id); ok((await PL.readOne(file('a.csv', BANK), ctx)).status === 'ignored', 'a removed file stays out');

  // ---- PDFs (the real readers are not changed; the routing and the failure handling are)
  const pdfCtx = r => mk({ RD: { readStatement: () => r } });
  const scan = await PL.readOne(file('s.pdf', PDFHEAD), pdfCtx({ type: 'unreadable', ok: false, problems: ['scan'] }));
  ok(scan.status === 'failed' && /scan/.test(scan.why) && /CSV/.test(scan.hint) && !scan.entry, 'a scanned PDF fails with the CSV hint and is not kept');
  const nope = await PL.readOne(file('n.pdf', PDFHEAD), pdfCtx({ type: 'unsupported', ok: false, problems: ['y'] }));
  ok(nope.status === 'failed' && /CSV/.test(nope.hint), 'an unrecognised PDF fails with the CSV hint');
  const noPeriod = await PL.readOne(file('p.pdf', PDFHEAD), pdfCtx({ type: 'amex', ok: true, txns: [] }));
  ok(noPeriod.status === 'failed', 'a PDF with no period is not a statement');
  const okPdf = await PL.readOne(file('m.pdf', PDFHEAD), pdfCtx({ type: 'amex', ok: true, period: { start: '2026-01-01', end: '2026-01-31' }, txns: [{}, {}], institution: 'Amex' }));
  ok(okPdf.status === 'added' && okPdf.mark === '✓' && okPdf.entry.result.type === 'amex', 'a good PDF is added exactly as before');
  const flagged = await PL.readOne(file('m2.pdf', PDFHEAD), pdfCtx({ type: 'amex', ok: false, period: { start: '2026-01-01', end: '2026-01-31' }, txns: [{}] }));
  ok(flagged.status === 'added' && flagged.mark === '⚠', 'a PDF read with a total that does not match keeps its existing warning');
  const empty = await PL.readOne(file('z.pdf', PDFHEAD), pdfCtx({ type: 'monzo', ok: false, period: { start: '2026-01-01', end: '2026-01-31' }, txns: [] }));
  ok(empty.status === 'failed' && /No transactions/.test(empty.why), 'a PDF statement with no readable transactions that does not add up is not kept');
  const quiet = await PL.readOne(file('q.pdf', PDFHEAD), pdfCtx({ type: 'amex', ok: true, period: { start: '2026-01-01', end: '2026-01-31' }, txns: [] }));
  ok(quiet.status === 'added', 'an empty month that does add up is kept');
  const boom = await PL.readOne(file('x.pdf', PDFHEAD), mk({ extractPages: async () => { throw new Error('corrupt'); } }));
  ok(boom.status === 'failed' && /corrupt/.test(boom.why), 'a PDF that cannot be opened fails without throwing');

  // ---- generic PDF reader: only when it can prove the rows, and only for PDFs no bank-specific reader knows
  const smartCtx = g => mk({ RD: { readStatement: () => ({ type: 'unsupported', problems: ['x'] }) }, SMART: { read: () => g } });
  const gTx = [{ date: '2026-01-02', desc: 'SHOP', amount: -500, balance: 9500 }, { date: '2026-01-03', desc: 'PAY', amount: 1000, balance: 10500 }];
  const proven = await PL.readOne(file('o.pdf', PDFHEAD), smartCtx({ confidence: 'verified', institution: 'Unknown bank', period: { start: '2026-01-02', end: '2026-01-03' }, txns: gTx, convention: 'bank' }));
  ok(proven.status === 'added' && proven.entry.result.type === 'csv' && proven.entry.result.source === 'pdf' && proven.mark === '✓' && proven.entry.result.sig === null, 'a proven generic PDF is added, shaped like a CSV, with no layout signature');
  ok((await PL.readOne(file('o2.pdf', PDFHEAD), smartCtx({ confidence: 'unverified', period: { start: '2026-01-02', end: '2026-01-03' }, txns: gTx }))).status === 'failed', 'an unproven generic PDF is refused');
  ok((await PL.readOne(file('o3.pdf', PDFHEAD), smartCtx({ confidence: 'failed', txns: [] }))).status === 'failed', 'a generic PDF whose sums disagree is refused');
  ok((await PL.readOne(file('o4.pdf', PDFHEAD), smartCtx({ confidence: 'scanned', txns: [] }))).why.includes('scan'), 'a scan is still reported as a scan');
  ok((await PL.readOne(file('o5.pdf', PDFHEAD), mk({ RD: { readStatement: () => ({ type: 'unsupported', problems: ['x'] }) }, SMART: null }))).status === 'failed', 'switched off: refused as before');
  ok((await PL.readOne(file('o6.pdf', PDFHEAD), mk({ RD: { readStatement: () => ({ type: 'unsupported', problems: ['x'] }) }, SMART: { read: () => { throw new Error('boom'); } } }))).status === 'failed', 'a crash inside the generic reader is a refusal, not an error');
  const bankPdf = await PL.readOne(file('b.pdf', PDFHEAD), mk({ RD: { readStatement: () => ({ type: 'amex', ok: true, period: { start: '2026-01-01', end: '2026-01-31' }, txns: [{}] }) }, SMART: { read: () => { throw new Error('must not be called'); } } }));
  ok(bankPdf.status === 'added' && bankPdf.entry.result.type === 'amex', 'a PDF a bank-specific reader knows never reaches the generic one');

  // ---- the summary
  const sum = PL.summarise([good, nb, bad, junk, { status: 'known' }, { status: 'known' }, { status: 'ignored' }], '2026-03-05T10:00:00Z');
  ok(sum.added.length === 2 && sum.failed.length === 2 && sum.known === 2 && sum.ignored === 1, 'summary counts');
  ok(sum.failed.every(f => f.name && f.why) && !JSON.stringify(sum).includes('SHOP ONE'), 'the summary holds names and reasons, never transactions');

  // ---- the result sheet and card
  global.document = undefined;
  const V = await import(path.join(root, 'js/importview.js'));
  const html1 = V.importSheet(sum); ok(/2 added/.test(html1) && /couldn't be read/.test(html1) && /○/.test(html1) && /✓/.test(html1), 'sheet shows counts and marks');
  ok(/checked: every row adds up/.test(html1) && /not checked/.test(html1), 'sheet explains the marks');
  ok(sum.added.every(a => a.waiting) && /Waiting for an account name/.test(html1), 'CSVs not given an account are shown as waiting in the result (was never shown)');
  { const named = PL.summarise([Object.assign({}, good, { attached: 'Card' })]); ok(!named.added[0].waiting && named.added[0].acct === 'Card', 'a named CSV is not waiting'); }
  ok(V.lastImportCard(null) === '' && /Dismiss/.test(V.lastImportCard(sum)), 'card shows only when there is something');

  // ---- CSVs never reach the figures
  global.window = { FinRules: require(path.join(root, 'rules.js')), FinParser: require(path.join(root, 'parser.js')), FinReaders: RD, SmartCSV: CSVR };
  const M = await import(path.join(root, 'js/model.js')); const { S } = await import(path.join(root, 'js/state.js'));
  S.files = { [good.id]: good.entry, [nb.id]: nb.entry };
  M.rebuild();
  ok(S.statements.length === 2 && S.statements.every(s => s.type === 'csv' && s.csv && s.csv.mark), 'CSV statements are listed with their mark');
  ok(S.txns.length === 0, 'CSV transactions are held out of the figures until the account is set up');
  const twin = await PL.readOne(file('a2.csv', BANK.replace('SHOP THREE', 'SHOP FOUR')), mk());
  S.files[twin.id] = twin.entry; M.rebuild();
  ok(S.statements.length === 3, 'two CSVs covering the same dates are not merged as duplicates');

  // ---- income documents (payslip, ISA, pension): read by readers/income.js and kept only when their own figures add up
  { const INCOME = require(path.join(root, 'readers/income.js'));
    const inc = lines => mk({ INCOME, toLines: pages => pages.map(text => ({ text })), RD: { readStatement: () => ({ type: 'unsupported', problems: ['x'] }) }, extractPages: async () => lines });
    const pdfBytes = name => { const h = new Uint8Array(PDFHEAD), t = new TextEncoder().encode(name), o = new Uint8Array(h.length + t.length); o.set(h); o.set(t, h.length); return o.buffer; }; // distinct bytes, so distinct file ids
    const rd = (name, lines) => PL.readOne(file(name, pdfBytes(name)), inc(lines));
    const SLIP = d => ['Payslip', 'Pay Date ' + d, 'Basic Pay 4,000.00', 'Gross Pay 4,000.00', 'Income Tax 600.00', 'National Insurance 250.00', 'Pension 200.00', 'Total Deductions 1,050.00', 'Net Pay 2,950.00'];
    const p1 = await rd('slip1.pdf', SLIP('25/11/2026'));
    ok(p1.status === 'added' && p1.mark === '✓' && p1.entry.result.type === 'payslip' && p1.entry.result.net === 295000 && p1.entry.result.ok, 'a payslip whose figures add up is added and checked');
    ok(p1.entry.result.txns.length === 0, 'a payslip adds no transactions, so it can never be counted twice with the bank deposit');
    const p2 = await rd('slip2.pdf', SLIP('25/11/2026').map(x => x.replace('2,950.00', '3,950.00')));
    ok(p2.status === 'failed' && !p2.entry && /payslip/.test(p2.why), 'a payslip that does not add up is refused and keeps nothing');
    const p3 = await rd('slip3.pdf', SLIP('25/11/2026').filter(x => !/Pay Date/.test(x)));
    ok(p3.status === 'failed' && /pay date/.test(p3.why), 'a proven payslip with no pay date is refused');
    const ISA = ['Vanguard Stocks & Shares ISA statement', 'Account number: 1234 5678', 'Statement from 1 July 2026 to 30 September 2026', 'Opening value £10,000.00', 'Money paid in £1,000.00', 'Withdrawals £0.00', 'Investment growth £250.00', 'Fees £25.00', 'Closing value £11,225.00'];
    const f1 = await rd('isa1.pdf', ISA);
    ok(f1.status === 'added' && f1.entry.result.type === 'savings' && f1.entry.result.kind === 'isa' && f1.entry.result.end === 1122500, 'an ISA statement that adds up is added');
    ok(f1.entry.result.fundKey === 'savings|isa|Vanguard|5678' && f1.entry.result.fundSuggest === 'Vanguard · ISA …5678', 'the account key and suggested name come from the provider, kind and last four digits');
    const f2 = await rd('isa2.pdf', ISA.map(x => x.replace('£11,225.00', '£11,300.00')));
    ok(f2.status === 'failed' && !f2.entry, 'an ISA statement that does not add up is refused');
    const nf = await rd('letter.pdf', ['Dear Sir', 'Please find enclosed the details of your appointment', 'Yours sincerely']);
    ok(nf.status === 'failed' && !nf.entry, 'a document that is none of these is not read and nothing is kept');
    // in the model: two payslips for one day stay apart; a fund statement takes the name the account was given
    const pa = await rd('slipA.pdf', SLIP('26/11/2026')), pb = await rd('slipB.pdf', SLIP('26/11/2026').map(x => x.replace('2,950.00', '2,850.00').replace('1,050.00', '1,150.00').replace('Income Tax 600.00', 'Income Tax 700.00')));
    S.files = { [pa.id]: pa.entry, [pb.id]: pb.entry, [f1.id]: f1.entry }; S.book = { accounts: [], assign: {}, layouts: {}, funds: { [f1.entry.result.fundKey]: 'Sam ISA' } }; M.rebuild();
    ok(S.payslips.length === 2, 'two payslips with the same date but different amounts are both kept');
    ok(S.funds.length === 1 && S.funds[0].fund === 'Sam ISA' && S.statements.find(s => s.type === 'savings').fund === 'Sam ISA', 'a fund statement is shown under the name you gave its account');
    ok(S.txns.length === 0, 'income documents add nothing to the transactions');
  }

  // ---- the browser has no `process`: the generic reader once crashed there (quietly, so every PDF was refused) while passing in Node
  { const src = fs.readFileSync(path.join(root, 'readers/smart.js'), 'utf8'); ok(!/[^.\w]process\.env/.test(src.replace(/typeof process[^\n]*/, '')), 'readers/smart.js never touches `process` directly (browser-safe)'); }

  console.log(fail ? `${fail} FAILED of ${n}` : `pipeline: all ${n} checks passed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASH', e); process.exit(1); });
