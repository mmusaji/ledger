// Account book, overlaps and how CSVs reach the figures (js/book.js, js/model.js). Everything is invented. Run: node tests/book.test.js
const path = require('path');
const root = path.resolve(__dirname, '..');
const CSVR = require(path.join(root, 'readers/csv.js')), RD = require(path.join(root, 'readers.js'));
let fail = 0, n = 0; const ok = (c, m) => { n++; if (!c) { fail++; console.log('FAIL', m); } };
global.crypto = global.crypto || require('crypto').webcrypto;

(async () => {
  const B = await import(path.join(root, 'js/book.js'));
  const tx = (date, amount, balance) => ({ date, amount, desc: 'X', balance: balance === undefined ? null : balance });

  // ---- layout memory: same columns = same layout, whatever the rows
  const r1 = { accountType: 'card', columns: { date: 'Date', amt: 'Amount', desc: ['Description'] } }, r2 = { accountType: 'card', columns: { date: ' date ', amt: 'AMOUNT', desc: ['description'] } };
  ok(B.layoutSig(r1) === B.layoutSig(r2), 'layout signature ignores case and spacing');
  ok(B.layoutSig(r1) !== B.layoutSig({ accountType: 'current', columns: r1.columns }), 'a card and a current account are different layouts');
  ok(B.layoutSig(r1) !== B.layoutSig({ accountType: 'card', columns: { date: 'Date', amt: 'Amount', desc: ['Merchant'] } }), 'different column names are a different layout');

  // ---- answers from the naming sheet
  const book = B.newBook();
  const a = B.applyChoice(book, { mode: 'new', name: 'Amex · Fizza', kind: 'card', payHint: 'AMEX' });
  ok(a.created && a.created.kind === 'card' && a.created.payHint === 'AMEX' && !a.created.role, 'new card account');
  const b = B.applyChoice(book, { mode: 'new', name: 'Monzo', kind: 'current', role: 'whatever' });
  ok(b.created.role === 'household', 'an unknown role falls back to household');
  ok(B.applyChoice(book, { mode: 'existing', accountId: a.accountId }).created === null, 'existing account creates nothing');
  const l1 = B.applyChoice(book, { mode: 'link', name: 'Joint account', link: { gkey: 'santander-1', accId: 'santander-1', label: 'Joint account', txnType: 'bank', kind: 'current' } });
  const l2 = B.applyChoice(book, { mode: 'link', name: 'Joint account', link: { gkey: 'santander-1', accId: 'santander-1', label: 'Joint account', txnType: 'bank', kind: 'current' } });
  ok(l1.accountId === l2.accountId && l2.created === null && book.accounts.length === 3, 'linking to the same PDF account twice reuses it');
  ok(B.suggestPayHint('Amex Gold') === 'AMERICAN EXP|AMEX' && B.suggestPayHint('Barclaycard Rewards') === 'BARCLAYCARD', 'payment wording suggestion');

  // ---- overlaps
  const src = (id, kind, rank, start, end, txns, gkey = 'A') => ({ id, name: id, kind, rank, gkey, period: { start, end }, txns });
  { // identical re-download: everything counted once
    const t = [tx('2026-01-02', -500), tx('2026-01-03', -700), tx('2026-01-03', -700), tx('2026-01-09', 1000)];
    const p = B.planOverlaps([src('one', 'csv', 1, '2026-01-02', '2026-01-09', t), src('two', 'csv', 1, '2026-01-02', '2026-01-09', t.slice())]);
    ok(p.drop.get('two').size === 4 && !p.drop.has('one'), 'the same CSV twice counts once');
    ok(p.report.get('two').dup === 4 && p.report.get('two').differs === 0, 'report: 4 duplicates, none differ');
  }
  { // two identical coffees on one day are two, not one
    const a1 = [tx('2026-01-03', -300), tx('2026-01-03', -300)], a2 = [tx('2026-01-03', -300), tx('2026-01-03', -300), tx('2026-01-03', -300)];
    const p = B.planOverlaps([src('one', 'csv', 1, '2026-01-01', '2026-01-05', a1), src('two', 'csv', 1, '2026-01-02', '2026-01-06', a2)]);
    ok(p.drop.get('two').size === 2 && p.report.get('two').kept === 1, 'three coffees across two files: two matched, the extra one kept');
  }
  { // partial overlap: only the overlapping days are matched; new days are kept
    const first = [tx('2026-01-01', -100), tx('2026-01-15', -200), tx('2026-01-31', -300)], second = [tx('2026-01-15', -200), tx('2026-01-31', -300), tx('2026-02-10', -400)];
    const p = B.planOverlaps([src('jan', 'csv', 1, '2026-01-01', '2026-01-31', first), src('later', 'csv', 1, '2026-01-15', '2026-02-10', second)]);
    ok([...p.drop.get('later')].join() === '0,1', 'rows in the overlap are dropped, the later one is kept');
  }
  { // a row inside the overlap with no counterpart is kept and reported, never silently dropped
    const first = [tx('2026-01-05', -100), tx('2026-01-20', -200)], second = [tx('2026-01-05', -100), tx('2026-01-12', -999), tx('2026-01-20', -200)];
    const p = B.planOverlaps([src('one', 'csv', 1, '2026-01-01', '2026-01-31', first), src('two', 'csv', 1, '2026-01-01', '2026-01-31', second)]);
    ok(p.report.get('two').differs === 1 && !p.drop.get('two').has(1), 'a row that does not match is kept and counted as differing');
  }
  { // a proven CSV beats an unproven one, whatever the order
    const t = [tx('2026-01-02', -500)];
    const p = B.planOverlaps([src('noBal', 'csv', 1, '2026-01-01', '2026-01-31', t), src('bal', 'csv', 2, '2026-01-01', '2026-01-31', t)]);
    ok(p.drop.has('noBal') && !p.drop.has('bal'), 'the CSV proven by its balance is the one kept');
  }
  { // a PDF that adds up is the whole statement for its dates
    const pdf = src('pdf', 'pdf', 3, '2026-01-01', '2026-01-31', [tx('2026-01-02', -500), tx('2026-01-10', -700)]);
    const csv = src('csv', 'csv', 2, '2026-01-01', '2026-02-15', [tx('2026-01-02', -500), tx('2026-01-10', -777), tx('2026-02-03', -100)]);
    const p = B.planOverlaps([csv, pdf]);
    ok([...p.drop.get('csv')].join() === '0,1' && !p.drop.has('pdf'), 'CSV rows dated inside a good PDF are dropped even when they differ; later rows are kept');
  }
  { // a PDF that did not add up gives way to a CSV for the same dates
    const bad = src('bad', 'pdf', 0, '2026-01-01', '2026-01-31', [tx('2026-01-02', -500)]), csv = src('csv', 'csv', 1, '2026-01-01', '2026-01-31', [tx('2026-01-02', -500)]);
    const p = B.planOverlaps([bad, csv]);
    ok(p.drop.has('bad') && !p.drop.has('csv'), 'a CSV replaces a PDF that did not add up');
  }
  { // a CSV that proves itself replaces every row of a PDF that did not add up, for the CSV's dates (the review sheet promises this)
    const bad = src('bad', 'pdf', 0, '2026-01-01', '2026-01-31', [tx('2026-01-02', -500), tx('2026-01-05', -999), tx('2026-02-01', -1)]);
    const csv = src('csv', 'csv', 2, '2026-01-01', '2026-01-31', [tx('2026-01-02', -500), tx('2026-01-05', -990)]);
    const p = B.planOverlaps([bad, csv]);
    ok([...p.drop.get('bad')].join() === '0,1' && !p.drop.has('csv'), 'a checked CSV replaces a PDF that did not add up, misread rows included; rows outside its dates stay');
  }
  { // two bank PDFs of one account are not judged here (Monzo has its own rule; judging twice lost the overlap days)
    const p = B.planOverlaps([src('m1', 'pdf', 3, '2026-01-01', '2026-03-31', [tx('2026-03-10', -100)]), src('m2', 'pdf', 3, '2026-03-01', '2026-04-30', [tx('2026-03-10', -100)])]);
    ok(p.drop.size === 0 && p.report.size === 0, 'PDF against PDF is left to the existing rules');
  }
  { // different accounts never touch each other
    const t = [tx('2026-01-02', -500)];
    const p = B.planOverlaps([src('a', 'csv', 1, '2026-01-01', '2026-01-31', t, 'A'), src('b', 'csv', 1, '2026-01-01', '2026-01-31', t, 'B')]);
    ok(p.drop.size === 0, 'two accounts with identical rows are both counted');
  }
  { // no overlap, no change
    const p = B.planOverlaps([src('a', 'csv', 1, '2026-01-01', '2026-01-31', [tx('2026-01-02', -500)]), src('b', 'csv', 1, '2026-02-01', '2026-02-28', [tx('2026-02-02', -500)])]);
    ok(p.drop.size === 0 && p.report.size === 0, 'files that do not overlap are untouched');
  }

  // ---- continuity
  {
    const g = B.continuity([src('a', 'csv', 1, '2026-01-01', '2026-01-31', [tx('2026-01-31', -1, 5000)]), src('b', 'csv', 1, '2026-03-05', '2026-03-31', [tx('2026-03-05', -1, 4999)])], x => 'Acct');
    ok(g.length === 1 && /nothing covers 2026-02-01 to 2026-03-04/.test(g[0].text), 'a gap of more than 3 days is reported');
    const c = B.continuity([src('a', 'csv', 1, '2026-01-01', '2026-01-31', [tx('2026-01-31', -100, 4900)]), src('b', 'csv', 1, '2026-02-01', '2026-02-28', [tx('2026-02-01', -100, 4000)])], x => 'Acct');
    ok(c.length === 1 && /does not carry over/.test(c[0].text), 'a balance that does not carry over is reported');
    const d = B.continuity([src('a', 'csv', 1, '2026-01-01', '2026-01-31', [tx('2026-01-31', -100, 4900)]), src('b', 'csv', 1, '2026-02-01', '2026-02-28', [tx('2026-02-01', -100, 4800)])], x => 'Acct');
    ok(d.length === 0, 'a clean hand-over and no gap reports nothing');
    const e = B.continuity([src('a', 'pdf', 3, '2026-01-01', '2026-01-31', [tx('2026-01-31', -100, 4900)]), src('b', 'pdf', 3, '2026-03-05', '2026-03-31', [])], x => 'Acct');
    ok(e.length === 0, 'accounts with no CSV in them are not judged here (the PDF coverage grid does that)');
  }

  // ---- through the model: CSVs reach the figures only once they have an account
  global.window = { FinRules: require(path.join(root, 'rules.js')), FinParser: require(path.join(root, 'parser.js')), FinReaders: RD, SmartCSV: CSVR };
  const M = await import(path.join(root, 'js/model.js')), { S } = await import(path.join(root, 'js/state.js')), PL = await import(path.join(root, 'js/pipeline.js'));
  const buf = s => new TextEncoder().encode(s).buffer;
  const file = (name, c) => ({ name, arrayBuffer: async () => buf(c) });
  const ctx = () => ({ files: {}, ignored: [], version: 3, CSVR, RD, extractPages: async () => [[]] });
  const CARD = 'Date,Description,Amount\n13/01/2026,SHOP ONE,12.00\n14/01/2026,CAFE TWO,3.50\n16/01/2026,PAYMENT RECEIVED THANK YOU,-100.00\n';
  const CARD2 = 'Date,Description,Amount\n14/01/2026,CAFE TWO,3.50\n16/01/2026,PAYMENT RECEIVED THANK YOU,-100.00\n20/01/2026,SHOP THREE,8.00\n';
  const o1 = await PL.readOne(file('card1.csv', CARD), ctx()), o2 = await PL.readOne(file('card2.csv', CARD2), ctx());
  S.files = { [o1.id]: o1.entry, [o2.id]: o2.entry }; S.book = B.newBook(); M.rebuild();
  ok(S.txns.length === 0, 'unnamed CSVs stay out of the figures');
  const card = B.applyChoice(S.book, { mode: 'new', name: 'Test Card', kind: 'card', payHint: 'TESTCARD' }).accountId;
  S.book.assign[o1.id] = card; M.rebuild();
  ok(S.txns.length === 3 && S.txns.every(t => t.type === 'card' && t.account === 'Test Card'), 'a named card CSV flows in as a card');
  const pay = S.txns.find(t => /PAYMENT/.test(t.desc));
  ok(S.txns.filter(t => t.amount < 0).length === 2 && pay && pay.amount > 0, 'card spend is negative; the payment line is positive');
  ok(pay && pay.kind === 'Card repayment received' && pay.group === 'internal', 'a payment to the card is internal, not income');
  S.book.assign[o2.id] = card; M.rebuild();
  ok(S.txns.length === 4, 'an overlapping second CSV adds only its new row (4 in total, not 6)');
  ok(S.overlap[o2.id] && S.overlap[o2.id].dup === 2, 'the overlap report says 2 rows were already counted');
  const sp = S.txns.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0); ok(sp === -(1200 + 350 + 800), 'card spend totals are right once overlaps are removed');

  // a bank payment to the card is its bill, so it is not spend again; the one before the CSV covers is
  S.files['pdf:fake'] = { name: 'bank.pdf', v: 3, result: { type: 'santander', ok: true, period: { start: '2026-01-01', end: '2026-03-31' }, account: { id: 'santander-1', bank: 'Santander', last4: '1' }, holders: [], institution: 'Santander', summary: null,
    txns: [{ date: '2026-02-20', desc: 'TESTCARD PAYMENT', amount: -10000, balance: 1000, type: 'bank', accId: 'santander-1', account: 'Joint account', kind: 'Direct debit' }, { date: '2026-01-05', desc: 'TESTCARD PAYMENT', amount: -5000, balance: 2000, type: 'bank', accId: 'santander-1', account: 'Joint account', kind: 'Direct debit' }] } };
  S.book.accounts.find(a => a.id === card).payHint = 'TESTCARD'; M.rebuild();
  const later = S.txns.find(t => t.date === '2026-02-20'), early = S.txns.find(t => t.date === '2026-01-05');
  ok(later && later.group === 'paidcard', 'a bank payment to a card the CSV covers is not counted as spend again');
  ok(early && early.group !== 'paidcard', 'a bank payment before the CSV starts is still the only record of that spend');
  delete S.files['pdf:fake'];

  // current account CSV, with a Monzo-style pot transfer
  S.files = {}; S.book = B.newBook(); S.accounts = {};
  const CURCSV = 'Date,Description,Type,Amount\n13/01/2026,SHOP ONE,Card payment,-12.00\n14/01/2026,EMPLOYER PAY,Faster payment,500.00\n15/01/2026,Savings,Pot transfer,-50.00\n';
  const oc = await PL.readOne(file('cur.csv', CURCSV), ctx()); S.files[oc.id] = oc.entry;
  const cur = B.applyChoice(S.book, { mode: 'new', name: 'Test Current', kind: 'current', role: 'household' }).accountId; S.book.assign[oc.id] = cur; S.accounts[cur] = { role: 'household' }; M.rebuild();
  ok(S.txns.length === 3 && S.txns.every(t => t.type === 'bank' && t.accId === cur), 'a named current-account CSV flows in as a current account');
  ok(S.accountList.length === 1 && S.accountList[0].role === 'household' && S.accountList[0].bank === 'Test Current', 'and appears as a household account');
  const pot = S.txns.find(t => /Savings/.test(t.desc)); ok(pot && pot.pot === true && pot.group === 'transfer', 'a pot transfer is recognised from the CSV Type column');
  ok(M.scopeTxns().length === 3, 'it is part of the household figures');
  ok(M.balanceSeries(M.scopeTxns().filter(M.isCurrent)).length === 0, 'with no balance column there is no balance line and nothing breaks');

  // two Monzo PDFs that overlap: the shared days are counted once, not lost (regression)
  {
    const mz = (name, start, end, rows) => ({ name, v: 3, result: { type: 'monzo', ok: true, institution: 'Monzo', period: { start, end }, account: { id: 'monzo-9', bank: 'Monzo', last4: '9' }, holders: [], opening: 0, closing: 0,
      txns: rows.map(([date, amount]) => ({ date, desc: 'SHOP ' + date, amount, balance: null, type: 'monzo', accId: 'monzo-9', account: 'Monzo', kind: 'Card payment' })) } });
    const keep = S.files; S.files = { 'pdf:m1': mz('m1.pdf', '2026-01-01', '2026-03-31', [['2026-02-10', -100], ['2026-03-10', -200]]), 'pdf:m2': mz('m2.pdf', '2026-03-01', '2026-04-30', [['2026-03-10', -200], ['2026-04-10', -300]]) };
    M.rebuild(); const m = S.txns.filter(t => t.accId === 'monzo-9').map(t => t.date).sort().join();
    ok(m === '2026-02-10,2026-03-10,2026-04-10', 'two overlapping Monzo PDFs: each day counted exactly once (was: the overlap was lost)');
    S.files = keep;
  }

  // left-out statements
  S.files['pdf:bad'] = { name: 'bad.pdf', v: 3, result: { type: 'amex', ok: false, problems: ['a total is off'], period: { start: '2026-02-01', end: '2026-02-28' }, account: null, txns: [{ date: '2026-02-03', desc: 'SHOP', amount: -1000, type: 'card', account: 'Amex' }], institution: 'Amex' } };
  M.rebuild(); ok(S.txns.some(t => t.source === 'bad.pdf'), 'a statement that does not add up is counted by default (as before)');
  S.files['pdf:bad'].hold = 'out'; M.rebuild(); ok(!S.txns.some(t => t.source === 'bad.pdf') && S.statements.find(s => s.name === 'bad.pdf').held, 'left out: its lines leave the figures and it stays listed');
  S.files['pdf:bad'].hold = 'keep'; M.rebuild(); ok(S.txns.some(t => t.source === 'bad.pdf') && S.statements.find(s => s.name === 'bad.pdf').acked, 'kept: counted and marked as checked by you');
  const Nt = await import(path.join(root, 'js/notices.js'));
  S.files['pdf:bad'].hold = undefined; M.rebuild(); ok(/did not add up/.test(Nt.figuresNotice()), 'the figures notice mentions it');
  S.files['pdf:bad'].hold = 'keep'; M.rebuild(); ok(Nt.figuresNotice() === '', 'and goes quiet once you have said it is fine');

  console.log(fail ? `${fail} FAILED of ${n}` : `book: all ${n} checks passed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASH', e); process.exit(1); });
