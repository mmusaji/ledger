// Synthetic Monzo statement (invented names/amounts) -> reader must reconcile; tampering must be caught.
const M = require('../readers/monzo.js');
const L = a => a.map(t => ({ text: t }));
function stmt(tamper) {
  return L([
    'Personal Account statement', '01/03/2026 - 31/03/2026', 'Alex Example £70 .00', 'Total balance',
    '£50 .00', 'Personal Account balance', '(Excluding all Pots)', '£20 .00', 'Balance in Pots',
    '-£60 .00', 'Total outgoings', '+£110 .00', 'Total deposits', 'Sort code: 04-00-04', 'Account number: 18759560', 'Monzo',
    '(GBP) (GBP)', 'Date Description Amount Balance',
    '30/03/2026 Transfer to Pot -5.00 50.00',
    'COSTA COFFEE 1 TOWN', '29/03/2026 -15.00 ' + (tamper ? '99.00' : '55.00'), 'GBR',
    'ALEX EXAMPLE (Faster Payments)', '28/03/2026 100.00 70.00', 'Reference: SALARY',
    '27/03/2026 Shop One LONDON GBR -40.00 -30.00',
    'Monzo Bank Limited (https://monzo.com) is a company', '(GBP) (GBP)', 'Date Description Amount Balance',
    '26/03/2026 Pal Example (P2P Payment) 10.00 10.00',
    'Pot statement', '01/03/2026 - 31/03/2026', '01/03/2026 Deposit 5.00 5.00']);
}
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
// opening balance implied: 10.00-10.00 = 0 ; -30 +... chain: 10 ->(-40)-> -30 ->(+100)-> 70 ->(-15)-> 55 ->(-5)-> 50
const good = M.read(stmt(false), 't.pdf');
ok(M.detect(stmt(false).map(l => l.text).join('\n')), 'detect');
ok(good.ok, 'good statement reconciles: ' + JSON.stringify(good.problems));
ok(good.txns.length === 5, 'five lines read');
ok(good.opening === 0 && good.closing === 5000, 'opening/closing');
ok(good.txns[0].date === '2026-03-26' && good.txns[4].pot, 'oldest first, pot flagged');
ok(good.txns.some(t => t.payee === 'COSTA COFFEE 1 TOWN' && /GBR/.test(t.desc)), 'multi-line merchant');
ok(good.txns.some(t => t.payee === 'ALEX EXAMPLE' && /SALARY/.test(t.desc)), 'multi-line transfer with reference');
ok(good.txns.find(t => /ALEX EXAMPLE/.test(t.desc)).self === true, 'own-name payment flagged as own account');
ok(good.txns.find(t => /Pal Example/.test(t.desc)).self === false, 'friend payment not flagged');
ok(good.pots === 2000 && good.txns[0].account === 'Monzo · Alex', 'pots balance and account label');
ok(good.account.id === 'monzo-9560' && good.txns[0].accId === 'monzo-9560', 'account identity from printed number');
ok(!M.read(stmt(true), 't.pdf').ok, 'tampered balance is caught');
if (fail) process.exit(1); console.log('monzo reader tests passed');
