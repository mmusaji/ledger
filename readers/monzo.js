/* Monzo personal account statement reader (PDF).
 * Plug-in contract: { id, detect(text) -> bool, read(lines, name) -> result, fixtures() -> tests }.
 * Reads only the "Personal Account statement" section. The separate "Pot statement" sections are ignored:
 * money moving to and from pots already appears in the main account as "Transfer to Pot" lines.
 * Verification: every line's running balance must follow from the line below it, the header totals
 * (deposits, outgoings) must equal what was read, and the newest balance must equal the printed account balance.
 */
(function (root) {
  'use strict';
  const pence = s => Math.round(parseFloat(String(s).replace(/[£,+\s]/g, '')) * 100);
  const gbp = p => (p < 0 ? '-' : '') + '£' + (Math.abs(p) / 100).toFixed(2);
  const fix = s => s.replace(/(\d) \.(\d{2})\b/g, '$1.$2').replace(/£\s+/g, '£').replace(/([a-z]) (ffi|fi|fl|ff) (?=[a-z])/g, '$1$2'); // pdf.js splits ligatures ("Ali fi a")
  const iso = d => d.slice(6, 10) + '-' + d.slice(3, 5) + '-' + d.slice(0, 2);
  const ROW = /^(\d{2}\/\d{2}\/\d{4})\s+(.*?)\s*(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})$/;
  const NOISE = /^(\(GBP\)|Date Description Amount Balance|Monzo Bank Limited|Broadwalk House|Regulation Authority|Our Financial Services)/;
  const TAIL = /^(Reference:|[A-Z]{3}$|Payments\)|Amount: [A-Z]{3} |[\d.]+\.$)/;
  const FALL = (a, b) => Math.abs(a - b) <= 0;

  const nameTokens = n => n.toLowerCase().replace(/[^a-z' -]/g, ' ').split(/\s+/).filter(Boolean);
  function sameName(a, b) { const x = nameTokens(a), y = nameTokens(b); return x.length > 1 && y.length > 1 && x[0] === y[0] && x[x.length - 1] === y[y.length - 1]; }

  function detect(all) { return /Personal Account statement/.test(all) && /Monzo/.test(all) && /Sort code/.test(all); }

  function payeeOf(d) {
    let m = d.match(/^(.+?) \((?:Faster Payments|P2P Payment|Bank Transfer)\)/);
    if (m) return m[1].trim();
    m = d.match(/^(.+?) \(Faster Payments?\b/);
    return (m ? m[1] : d).replace(/\s+Amount: [A-Z]{3} .*$/, '').replace(/\s+[A-Z]{3}$/, '').trim().slice(0, 40);
  }

  function read(lines, name) {
    const all = lines.map(l => fix(l.text)).join('\n');
    const per = all.match(/(\d{2}\/\d{2}\/\d{4}) - (\d{2}\/\d{2}\/\d{4})/);
    if (!per) return { ok: false, problems: ['Monzo: could not find the statement period.'] };
    const header = all.split('\n').slice(0, 40).join('\n');
    const grab = re => { const m = header.match(re); return m ? pence(m[1]) : null; };
    const closingStated = grab(/(£[\d,]+\.\d{2})\s*\n?(?:[^\n]*\n){0,2}?[^\n]*Personal Account balance/) ;
    const totalOut = grab(/(-£[\d,]+\.\d{2})\s*\n(?:[^\n]*\n)?[^\n]*Total outgoings/);
    const totalIn = grab(/(\+£[\d,]+\.\d{2})\s*\n(?:[^\n]*\n)?[^\n]*Total deposits/);
    const closingHdr = (() => {
      // value printed just before the label "Personal Account balance" (the label sits on its own row below the figure)
      const L = header.split('\n'); const i = L.findIndex(x => /Personal Account balance/.test(x));
      for (let k = i; k >= Math.max(0, i - 2); k--) { const m = L[k].match(/£([\d,]+\.\d{2})/); if (m) return pence(m[1]); }
      return null;
    })();
    const potsBal = (() => {
      const L = header.split('\n'); const i = L.findIndex(x => /Balance in Pots/.test(x));
      for (let k = i; k >= Math.max(0, i - 2); k--) { const m = L[k].match(/£([\d,]+\.\d{2})/); if (m) return pence(m[1]); }
      return null;
    })();
    const an = all.match(/Account number:\s*(\d{4,})/);
    const holder = (lines.map(l => l.text).find(t => /^[A-Za-z' -]+ £[\d,]+ ?\.\d{2}$/.test(fix(t))) || '').replace(/\s*£.*$/, '');

    const rows = []; let pre = [], inTable = false, lastEmpty = null;
    for (const l of lines) {
      const t = fix(l.text).trim();
      if (/^Pot statement/.test(t)) break;
      if (/Personal Account statement/.test(t)) { inTable = false; continue; }
      if (/^Date Description Amount Balance/.test(t)) { inTable = true; pre = []; continue; }
      if (!inTable || NOISE.test(t)) continue;
      const m = t.match(ROW);
      if (m) {
        let head = m[2].trim(); const fx = /^Amount: [A-Z]{3} /.test(head) ? head : null; // card payment abroad: merchant is above the date line
        if (fx) head = '';
        if (!head) {
          // description sits on the lines around the date line; trailing lines of the previous row come first
          let k = 0;
          if (lastEmpty) { while (k < pre.length && TAIL.test(pre[k])) { lastEmpty.tail.push(pre[k]); k++; } }
          head = pre.slice(k).join(' ');
        } else if (lastEmpty) { lastEmpty.tail.push(...pre); }
        const row = { date: m[1], head, tail: fx ? [fx] : [], amount: pence(m[3]), balance: pence(m[4]) };
        rows.push(row); lastEmpty = m[2].trim() && !fx ? null : row; pre = [];
      } else pre.push(t);
    }
    if (lastEmpty) pre.forEach(p => { if (TAIL.test(p)) lastEmpty.tail.push(p); });

    const problems = [];
    // rows are newest first: row[i].balance - row[i].amount must equal row[i+1].balance
    let breaks = 0;
    for (let i = 0; i < rows.length - 1; i++) if (!FALL(rows[i].balance - rows[i].amount, rows[i + 1].balance)) breaks++;
    if (breaks) problems.push(`Monzo: ${breaks} line(s) where the running balance does not follow on.`);
    const sumIn = rows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);
    const sumOut = rows.filter(r => r.amount < 0).reduce((s, r) => s + r.amount, 0);
    if (totalIn !== null && sumIn !== totalIn) problems.push(`Monzo deposits: read ${gbp(sumIn)}, statement says ${gbp(totalIn)}`);
    if (totalOut !== null && sumOut !== totalOut) problems.push(`Monzo outgoings: read ${gbp(sumOut)}, statement says ${gbp(totalOut)}`);
    if (totalIn === null || totalOut === null) problems.push('Monzo: could not find the deposit and outgoing totals to check against.');
    const closing = rows.length ? rows[0].balance : null;
    if (closingHdr !== null && closing !== closingHdr) problems.push(`Monzo closing balance: read ${gbp(closing)}, statement says ${gbp(closingHdr)}`);
    if (!rows.length) problems.push('Monzo: no transactions found.');

    const txns = rows.slice().reverse().map(r => {
      const desc = (r.head + ' ' + r.tail.join(' ')).replace(/\s+/g, ' ').trim();
      const pot = /^(Transfer to|Withdrawal from|Deposit)\b.*\bPot\b|^Transfer to Pot$|^Transfer from Pot$/i.test(desc);
      const cp = pot ? null : payeeOf(desc);
      const fxm = desc.match(/Amount: ([A-Z]{3}) -?[\d.,]+/);
      const bt = /\((?:Faster Payments|Bank Transfer)\)/.test(desc);
      // a bank payment sent from / to someone with the account holder's own name is the holder's own other account
      const self = !!(bt && cp && sameName(cp, holder));
      return { date: iso(r.date), desc, amount: r.amount, balance: r.balance, payee: pot ? 'Pot' : cp,
        kind: pot ? 'Pot transfer' : /\((?:Faster Payments|P2P Payment|Bank Transfer)\)/.test(desc) ? 'Bank transfer' : 'Card',
        currency: fxm ? fxm[1] : undefined, account: 'Monzo · ' + (holder.split(/\s+/)[0] || 'Account'), holder: (holder.split(/\s+/)[0] || 'Monzo'), type: 'monzo', accId: an ? 'monzo-' + an[1].slice(-4) : 'monzo', pot, self, counterparty: cp };
    });
    const opening = txns.length ? txns[0].balance - txns[0].amount : null;
    return { ok: problems.length === 0, type: 'monzo', institution: 'Monzo',
      period: { start: iso(per[1]), end: iso(per[2]) }, opening, closing, totalIn, totalOut, pots: potsBal, holders: [holder.split(/\s+/)[0] || 'Monzo'], account: { id: an ? 'monzo-' + an[1].slice(-4) : 'monzo', bank: 'Monzo', last4: an ? an[1].slice(-4) : '' },
      txns, checks: { chain: breaks === 0, deposits: sumIn === totalIn, outgoings: sumOut === totalOut, closing: closing === closingHdr }, problems };
  }

  const plugin = { id: 'monzo', detect, read };
  if (typeof module !== 'undefined' && module.exports) module.exports = plugin;
  else { root.FinPlugins = root.FinPlugins || []; root.FinPlugins.push(plugin); }
})(typeof self !== 'undefined' ? self : this);
