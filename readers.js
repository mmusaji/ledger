/* Statement readers for cards, payslips, ISA and pension statements, plus the dispatcher
 * that works out what a PDF is from its contents (never from its file name).
 * Each reader checks its own totals against the figures printed on the statement.
 */
(function (root) {
  'use strict';
  const FP = root.FinParser || (typeof require !== 'undefined' ? require('./parser.js') : null);

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const MON = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
  const AMT = '(-?£?\\s?[\\d,]*\\d\\.\\d{2})';
  const pad = n => String(n).padStart(2, '0');
  const iso = d => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  const money = s => Math.round(parseFloat(String(s).replace(/[£,\s]/g, '')) * 100);
  const mi = m => MONTHS[m.slice(0, 3).toLowerCase()];
  const titleName = s => s.trim().split(/\s+/)[0].toLowerCase().replace(/^./, c => c.toUpperCase());
  const gbp = p => (p < 0 ? '-' : '') + '£' + (Math.abs(p) / 100).toFixed(2);

  /** Pick the year for a day/month so it falls inside the statement period. */
  function inPeriod(day, month, period) {
    const s = new Date(period.start + 'T00:00:00Z'), e = new Date(period.end + 'T00:00:00Z');
    for (const y of [e.getUTCFullYear(), s.getUTCFullYear(), e.getUTCFullYear() - 1]) {
      const d = new Date(Date.UTC(y, month, day));
      if (d >= new Date(s.getTime() - 40 * 864e5) && d <= new Date(e.getTime() + 5 * 864e5)) return iso(d);
    }
    return iso(new Date(Date.UTC(e.getUTCFullYear(), month, day)));
  }
  function periodFrom(sd, sm, sy, ed, em, ey) {
    const end = new Date(Date.UTC(+ey, mi(em), +sd > 0 ? +ed : +ed));
    let startY = sy ? +sy : +ey;
    if (!sy && mi(sm) > mi(em)) startY = +ey - 1;
    return { start: iso(new Date(Date.UTC(startY, mi(sm), +sd))), end: iso(end) };
  }
  function finish(r) {
    r.problems = r.problems || [];
    Object.entries(r.checks || {}).forEach(([k, v]) => { if (v && v.ok === false) r.problems.push(v.msg); });
    r.ok = r.problems.length === 0;
    return r;
  }
  const check = (label, got, want, tol = 0) => ({ ok: Math.abs(got - want) <= tol, msg: `${label}: read ${gbp(got)}, statement says ${gbp(want)}` });

  // ---------------------------------------------------------------- Amex
  function parseAmex(lines) {
    const all = lines.map(l => l.text).join('\n');
    const pm = all.match(new RegExp(`Statement Period From (\\d{1,2}) ${MON}[a-z]*(?: (\\d{4}))? to (\\d{1,2}) ${MON}[a-z]* (\\d{4})`));
    if (!pm) return { ok: false, problems: ['Amex: could not find the statement period.'] };
    const period = periodFrom(pm[1], pm[2], pm[3], pm[4], pm[5], pm[6]);
    const sm = all.match(/£\s?([\d,]+\.\d{2})\s*-\s*£\s?([\d,]+\.\d{2})\s*\+\s*£\s?([\d,]+\.\d{2})\s*=\s*£\s?(-?[\d,]+\.\d{2})/);
    const summary = sm ? { previous: money(sm[1]), credits: money(sm[2]), debits: money(sm[3]), closing: money(sm[4]) } : null;
    const primary = (all.match(/Prepared for Membership Number Date\n(.+?) xxxx/) || [])[1];

    const TXN = new RegExp(`^${MON} (\\d{1,2}) ${MON} (\\d{1,2}) (.+?)(?: ([\\d,]+\\.\\d{2}))? ([\\d,]*\\.\\d{2})( CR)?$`);
    const txns = []; const holderTotals = {}; let pending = []; let inTable = false; let other = false; let last = null; let stop = false;
    const credits = { total: 0 }, debits = { total: 0 };
    for (let i = 0; i < lines.length && !stop; i++) {
      const t = lines[i].text;
      if (/^Date Date Transaction Details/.test(t)) { inTable = true; last = null; continue; }
      if (/^How you can pay your statement/.test(t) || /^Membership Rewards/.test(t)) { inTable = false; last = null; if (/^Membership Rewards/.test(t)) stop = true; continue; }
      if (!inTable) continue;
      if (/^OTHER ACCOUNT TRANSACTIONS/.test(t)) { other = true; last = null; continue; }
      let m = t.match(/^Total new spend transactions for (.+?) (-?[\d,]+\.\d{2})( CR)?$/);
      if (m) {
        const holder = titleName(m[1]);
        let tot = money(m[2]); if (m[3] || (lines[i + 1] && lines[i + 1].text === 'CR')) tot = -tot;
        const got = pending.reduce((s, x) => s - x.amount, 0);
        holderTotals[holder] = check(`Amex ${holder} spend`, got, tot);
        pending.forEach(x => { x.holder = holder; x.account = 'Amex · ' + holder; });
        pending = []; last = null; continue;
      }
      m = t.match(/^Total of other account transactions (-?[\d,]+\.\d{2})( CR)?$/);
      if (m) {
        let tot = money(m[1]); if (m[2] || (lines[i + 1] && lines[i + 1].text === 'CR')) tot = -tot;
        const got = pending.reduce((s, x) => s - x.amount, 0);
        holderTotals.Account = check('Amex other account transactions', got, tot);
        pending.forEach(x => { x.holder = 'Account'; x.account = 'Amex · ' + (primary ? titleName(primary) : 'Account'); x.accountLevel = true; });
        pending = []; last = null; other = false; continue;
      }
      m = t.match(TXN);
      if (m) {
        const date = inPeriod(+m[2], mi(m[1]), period);
        const desc = m[5].trim();
        const gbpAmt = money(m[7]);
        const tx = { date, desc, amount: -gbpAmt, foreign: m[6] ? m[6] : '', currency: '', fxFee: 0, type: 'card' };
        if (m[8]) tx.amount = gbpAmt;
        if (/PAYMENT RECEIVED/i.test(desc)) { tx.kind = 'Card repayment received'; tx.amount = gbpAmt; }
        else tx.kind = other ? 'Card fee/credit' : 'Card purchase';
        txns.push(tx);
        if (tx.kind === 'Card repayment received') tx.holder = 'Account'; else pending.push(tx);
        last = tx; continue;
      }
      if (!last) continue;
      if (t === 'CR') { if (last.amount < 0) last.amount = -last.amount; continue; }
      const fx = t.match(/Exchange Rate ([\d.]+) \+ Nonsterling Transaction Fee ([\d.]+)/);
      if (fx) { last.fxRate = +fx[1]; last.fxFee = money(fx[2]); continue; }
      if (/^[A-Z ]*(DOLLAR|EURO|POUND|YEN|DIRHAM|RUPEE|FRANC|KRONA|ZLOTY|PESO|LIRA|RAND|RIYAL|RINGGIT|BAHT|DONG|WON)S?$/.test(t)) { last.currency = t; continue; }
      if (!last.detail && t.length < 80 && !/^(ROUTING|TO:|TICKET|PASSENGER)/.test(t)) last.detail = t;
    }
    // A payment row's CR may come on the following line: make sure payments are credits.
    txns.forEach(x => { if (x.kind === 'Card repayment received') x.amount = Math.abs(x.amount); });
    if (!primary) txns.forEach(x => { if (x.holder === 'Account') x.account = 'Amex'; });
    txns.filter(x => x.kind === 'Card repayment received').forEach(x => { x.account = 'Amex · ' + (primary ? titleName(primary) : 'Account'); });
    txns.forEach(x => { if (x.amount < 0) debits.total -= x.amount; else credits.total += x.amount; });
    const checks = Object.assign({}, holderTotals);
    if (summary) {
      checks.debits = check('Amex new debits', debits.total, summary.debits);
      checks.credits = check('Amex new credits', credits.total, summary.credits);
      checks.balance = check('Amex balance', summary.previous - summary.credits + summary.debits, summary.closing);
    } else checks.summary = { ok: false, msg: 'Amex: could not read the account summary.' };
    if (pending.length) checks.unassigned = { ok: false, msg: `Amex: ${pending.length} transactions not matched to a cardholder.` };
    txns.forEach(x => { x.payee = cleanMerchant(x.desc); x.source = ''; });
    return finish({ type: 'amex', institution: 'Amex', period, summary, txns, checks, holders: Object.keys(holderTotals).filter(h => h !== 'Account') });
  }

  // ---------------------------------------------------------------- Tesco Clubcard credit card
  function parseTesco(lines) {
    const all = lines.map(l => l.text).join('\n');
    const pm = all.match(new RegExp(`(\\d{1,2}) ${MON}[a-z]*(?: (\\d{4}))? - (\\d{1,2}) ${MON}[a-z]* (\\d{4})`));
    if (!pm) return { ok: false, problems: ['Tesco: could not find the statement period.'] };
    const period = periodFrom(pm[1], pm[2], pm[3], pm[4], pm[5], pm[6]);
    const grab = re => { const m = all.match(re); return m ? money(m[1]) : null; };
    const summary = {
      previous: grab(/Previous balance £ ?([\d,]+\.\d{2})/), payments: grab(/Payments in £ ?([\d,]+\.\d{2})/),
      spending: grab(/Spending plus any adjustments £ ?(-?[\d,]+\.\d{2})/), fees: grab(/\bFees £ ?([\d,]+\.\d{2})/),
      interest: grab(/\bInterest £ ?([\d,]+\.\d{2})/), closing: grab(/New balance £ ?(-?[\d,]+\.\d{2})/)
    };
    const holder = titleName(((all.match(/Cardholder (?:MR|MRS|MS|MISS|DR) ([A-Z]+)/) || [])[1]) || 'Card');
    const account = 'Tesco · ' + holder;
    const TXN = new RegExp(`^(\\d{2}) ?${MON.toUpperCase()} (\\d{2}) ?${MON.toUpperCase()} (\\d{6,10}) (.+?)(?: (-?£[\\d,]+\\.\\d{2}))?$`);
    const txns = []; let last = null; let started = false;
    for (const { text: t } of lines) {
      if (/BALANCE FROM PREVIOUS STATEMENT/.test(t)) { started = true; continue; }
      if (!started) continue;
      if (/^NEW BALANCE/.test(t)) break;
      if (/^Balance brought forward|^Date$|^Trans|^Post|^Description|^Pay easily|^CLUBCARD|^\d+ - \d+ \w+ \d{4}|^\d+ of \d+|^Amount Date/.test(t)) continue;
      const m = t.match(TXN);
      if (m) {
        const date = inPeriod(+m[1], mi(m[2]), period);
        const desc = m[6].trim();
        const tx = { date, desc, amount: m[7] ? -money(m[7]) : null, holder, account, type: 'card', foreign: '' };
        tx.kind = /PAYMENT - THANK YOU|DIRECT DEBIT PAYMENT/i.test(desc) ? 'Card repayment received' : /^(INTEREST|LATE PAYMENT|OVER ?LIMIT|CASH (ADVANCE|HANDLING)|RETURNED PAYMENT|ANNUAL FEE)/i.test(desc) ? 'Card fee/credit' : 'Card purchase';
        txns.push(tx); last = tx; continue;
      }
      if (!last) continue;
      const fee = t.match(/FOREIGN EXCHANGE FEE.*?£([\d,]+\.\d{2})$/);
      if (fee) { txns.push({ date: last.date, desc: 'Foreign exchange fee: ' + last.desc, amount: -money(fee[1]), holder, account, type: 'card', kind: 'Card fee/credit', foreign: '' }); continue; }
      const fx = t.match(/^([\d,.]+) ([A-Z]{3}) EXCHANGE RATE ([\d.]+) (-?£[\d,]+\.\d{2})$/);
      if (fx && last.amount === null) { last.amount = -money(fx[4]); last.foreign = fx[1]; last.currency = fx[2]; last.fxRate = +fx[3]; continue; }
      const lone = t.match(/^(-?£[\d,]+\.\d{2})$/);
      if (lone && last.amount === null) { last.amount = -money(lone[1]); continue; }
    }
    const missing = txns.filter(x => x.amount === null);
    const spend = -txns.filter(x => x.kind === 'Card purchase').reduce((s, x) => s + x.amount, 0);
    const fees = -txns.filter(x => x.kind === 'Card fee/credit').reduce((s, x) => s + x.amount, 0);
    const pays = txns.filter(x => x.kind === 'Card repayment received').reduce((s, x) => s + x.amount, 0);
    const checks = {};
    if (summary.spending !== null) checks.spending = check('Tesco spending', spend, summary.spending);
    if (summary.fees !== null && summary.interest !== null) checks.fees = check('Tesco fees and interest', fees, summary.fees + summary.interest);
    if (summary.payments !== null) checks.payments = check('Tesco payments', pays, summary.payments);
    if (Object.values(summary).every(v => v !== null)) checks.balance = check('Tesco balance', summary.previous - summary.payments + summary.spending + summary.fees + summary.interest, summary.closing);
    if (missing.length) checks.missing = { ok: false, msg: `Tesco: ${missing.length} transactions without an amount.` };
    txns.forEach(x => { x.payee = cleanMerchant(x.desc); x.source = ''; });
    return finish({ type: 'tesco', institution: 'Tesco', period, summary, txns: txns.filter(x => x.amount !== null), checks, holders: [holder] });
  }

  /** Make card merchant names readable: "AMZNMKTPLACE*R19GF5385 AMAZON.CO.UK" → "Amazon". */
  function cleanMerchant(desc) {
    let d = desc.replace(/\s+/g, ' ').trim();
    const known = [[/AMZN|AMAZON/i, 'Amazon'], [/DELIVEROO/i, 'Deliveroo'], [/CO-OP|COOPERATIVE/i, 'Co-op'], [/TESCO STORE|TESCO STORES|TESCO PAY AT PUMP/i, 'Tesco'],
      [/SAINSBURY/i, "Sainsbury's"], [/CHAIIWALA/i, 'Chaiiwala'], [/SHELL/i, 'Shell'], [/YOUTUBE/i, 'YouTube'], [/NETFLIX/i, 'Netflix'],
      [/UBER/i, 'Uber'], [/ANTHROPIC|CLAUDE/i, 'Claude'], [/0606 - LEICESTER HIGH C/i, 'John Lewis'], [/GOOGLE \*GOOGLE PLAY|GOOGLE PLAY/i, 'Google Play'],
      [/PAYMENT RECEIVED|FASTER PAYMENT - THANK YOU/i, 'Card repayment'], [/TURO/i, 'Turo'], [/AIR ?CAN/i, 'Air Canada'], [/BUMPER/i, 'Bumper']];
    for (const [re, name] of known) if (re.test(d)) return name;
    d = d.replace(/^(SQ|SumUp|RYFT|DOJO|VIVA|PAYPAL|PayPal_?|MNK|UBR|SP|ZETTLE|IZ)\s?\*\s?/i, '');
    d = d.replace(/\b\d{4,}\b.*$/, '').replace(/\s(LEICESTER|LONDON|GBR|GB|ENG|LND|UNITED KINGDOM|MISSISSAUGA|NOTTINGHAM)\b.*$/i, '').trim();
    return d.slice(0, 32).replace(/\b([A-Z])([A-Z']+)\b/g, (_, a, b) => a + b.toLowerCase()) || desc.slice(0, 32);
  }

  // ---------------------------------------------------------------- Payslip (ePay layout)
  function parsePayslip(lines) {
    const all = lines.map(l => l.text).join('\n');
    const pd = all.match(/Pay Day (\d{2})\/(\d{2})\/(\d{4})/);
    if (!pd) return { ok: false, problems: ['Payslip: no pay day found.'] };
    const payDate = `${pd[3]}-${pd[2]}-${pd[1]}`;
    const employer = ((all.match(/\n(.+?) Tax Month/) || [])[1] || '').trim();
    const taxMonth = +((all.match(/Tax Month (\d{1,2})/) || [])[1] || 0);
    const startIdx = lines.findIndex(l => /^Earnings Units Rate Amount Deductions Amount/.test(l.text));
    const endIdx = lines.findIndex(l => /^Total Earnings/.test(l.text));
    const items = [];
    const PAIR = /(\*?[A-Za-z][A-Za-z0-9 ()&'\/.,-]*?)\s+(-?[\d,]+\.\d{2})(?=\s|$)/g;
    const DEDUCTION = /^(Tax\b|NI\b|ESPP\d|RSU Withholding|Student Loan|Postgrad|Union|Give As You Earn|Payroll Giving|Deduction)/i;
    for (let i = startIdx + 1; i < endIdx && startIdx >= 0; i++) {
      const t = lines[i].text; if (/Notional pay items/.test(t)) continue;
      let m; PAIR.lastIndex = 0;
      while ((m = PAIR.exec(t))) {
        const label = m[1].trim(), amount = money(m[2]);
        items.push({ label: label.replace(/^\*/, ''), amount, kind: label.startsWith('*') ? 'notional' : DEDUCTION.test(label) ? 'deduction' : 'earning' });
      }
    }
    const te = all.match(/Total Earnings (-?[\d,]+\.\d{2}) Total Deductions (-?[\d,]+\.\d{2})/);
    const totalEarnings = te ? money(te[1]) : null, totalDeductions = te ? money(te[2]) : null;
    const net = money((all.match(/Net Pay (-?[\d,]+\.\d{2})/) || [])[1] || (all.match(/Amount Paid (-?[\d,]+\.\d{2})/) || [])[1] || '0');
    const sumK = k => items.filter(x => x.kind === k).reduce((s, x) => s + x.amount, 0);
    const find = re => items.filter(x => re.test(x.label)).reduce((s, x) => s + x.amount, 0);
    const pensionEmployee = -find(/Aviva PSE Employee|Pension|Salary Sacrifice/i);
    const employerAll = [...all.matchAll(/Aviva PSE Employer (-?[\d,]+\.\d{2})/g)].map(m => money(m[1]));
    const pensionEmployer = employerAll.length ? employerAll[employerAll.length - 1] : 0;
    const basic = find(/^Basic Pay/i), car = find(/Car Allowance/i);
    const variable = items.filter(x => x.kind === 'earning' && !/^Basic Pay|Car Allowance|Aviva PSE|Pension|Salary Sacrifice/i.test(x.label)).reduce((s, x) => s + x.amount, 0);
    const tax = find(/^Tax\b/), ni = find(/^NI\b/), espp = find(/^ESPP\d/), rsuWithholding = find(/RSU Withholding/i);
    const rsuIncome = items.filter(x => x.kind === 'notional' && /RSU/i.test(x.label)).reduce((s, x) => s + x.amount, 0);
    const otherDeductions = sumK('deduction') - tax - ni - espp - rsuWithholding;
    const ytdBlock = all.slice(all.indexOf('Running Totals'));
    const y = re => { const m = ytdBlock.match(re); return m ? money(m[1]) : null; };
    const ytd = { gross: y(/Gross Pay (-?[\d,]+\.\d{2})/), taxable: y(/Taxable Pay (-?[\d,]+\.\d{2})/), tax: y(/\nTax (-?[\d,]+\.\d{2})/), ni: y(/Employee's NI (-?[\d,]+\.\d{2})/),
      pensionEmployee: y(/Aviva PSE Employee (-?[\d,]+\.\d{2})/), pensionEmployer: y(/Aviva PSE Employer (-?[\d,]+\.\d{2})/) };
    const annualSalary = money((all.match(/Annual Salary (-?[\d,]+\.\d{2})/) || [])[1] || '0');
    const checks = {};
    if (totalEarnings !== null) {
      checks.earnings = check('Payslip earnings', sumK('earning'), totalEarnings);
      checks.deductions = check('Payslip deductions', sumK('deduction'), totalDeductions);
      checks.net = check('Payslip net pay', totalEarnings - totalDeductions, net);
    } else checks.totals = { ok: false, msg: 'Payslip: totals not found.' };
    return finish({
      type: 'payslip', institution: employer || 'Payslip', period: { start: payDate, end: payDate }, payDate, taxMonth, employer,
      items, basic, car, variable, grossBeforePension: totalEarnings + pensionEmployee, pensionEmployee, pensionEmployer, taxablePay: totalEarnings,
      tax, ni, espp, rsuWithholding, rsuIncome, otherDeductions, totalDeductions, net, ytd, annualSalary, checks, txns: []
    });
  }

  // ---------------------------------------------------------------- Moneyfarm ISA quarterly statement
  function parseMoneyfarm(lines) {
    const all = lines.map(l => l.text).join('\n');
    const pm = all.match(/from (\d{1,2}) ([A-Za-z]+) (\d{4}) to (\d{1,2}) ([A-Za-z]+) (\d{4})/);
    if (!pm) return { ok: false, problems: ['Moneyfarm: no statement period found.'] };
    const period = { start: iso(new Date(Date.UTC(+pm[3], mi(pm[2]), +pm[1]))), end: iso(new Date(Date.UTC(+pm[6], mi(pm[5]), +pm[4]))) };
    const after = (label) => { const i = all.indexOf(label); if (i < 0) return null; const m = all.slice(i + label.length).match(/(-?£[\d,]+(?:\.\d{2})?)/); return m ? money(m[1]) : null; };
    const tot = all.match(/\nTotal (£[\d,]+(?:\.\d{2})?) (£[\d,]+(?:\.\d{2})?)\n/);
    const start = tot ? money(tot[1]) : after('Starting value at');
    const end = tot ? money(tot[2]) : after('Amount in an ISA wrapper at');
    const isaValue = after('Amount in an ISA wrapper at');
    const contributions = [...all.matchAll(/(\d{4}-\d{2}-\d{2}) Bank input (£[\d,]+(?:\.\d{2})?)/g)].map(m => ({ date: m[1], amount: money(m[2]) }));
    const uniq = [...new Map(contributions.map(c => [c.date + c.amount, c])).values()];
    const paidIn = uniq.reduce((s, c) => s + c.amount, 0);
    const withdrawals = [...all.matchAll(/(\d{4}-\d{2}-\d{2}) (?:Withdrawal|Bank output)[^£]*(£[\d,]+(?:\.\d{2})?)/g)].map(m => ({ date: m[1], amount: money(m[2]) }));
    const paidOut = [...new Map(withdrawals.map(c => [c.date + c.amount, c])).values()].reduce((s, c) => s + c.amount, 0);
    const ret = after('Investment returns in the period');
    const fees = after('Fees charged to your ISA account in the');
    const allowance = after('Remaining ISA allowance');
    const checks = {};
    if ([start, end, ret].every(v => v !== null)) checks.value = check('Moneyfarm value', start + paidIn - paidOut + ret, end, 2); // Moneyfarm prints rounded figures
    if (isaValue !== null && end !== null) checks.isa = check('Moneyfarm ISA total', end, isaValue);
    return finish({ type: 'moneyfarm', institution: 'Moneyfarm ISA', period, start, end, contributions: uniq, paidIn, paidOut, investmentReturn: ret, fees, isaAllowanceLeft: allowance, checks, txns: [] });
  }

  // ---------------------------------------------------------------- Aviva workplace pension annual statement
  function parseAviva(lines) {
    const all = lines.map(l => l.text).join('\n');
    const pm = all.match(/Statement for\n(\d{1,2}) ([A-Za-z]+) (\d{4}) to (\d{1,2}) ([A-Za-z]+) (\d{4})/);
    if (!pm) return { ok: false, problems: ['Aviva: no statement period found.'] };
    const period = { start: iso(new Date(Date.UTC(+pm[3], mi(pm[2]), +pm[1]))), end: iso(new Date(Date.UTC(+pm[6], mi(pm[5]), +pm[4]))) };
    const four = all.match(/(£[\d,]+\.\d{2}) (£[\d,]+\.\d{2}) (£[\d,]+\.\d{2}) (£[\d,]+\.\d{2})\nValue of your pension Money paid in Money paid out Value of your pension/);
    const after = (label) => { const i = all.indexOf(label); if (i < 0) return null; const before = all.slice(Math.max(0, i - 40), i).match(/(£[\d,]+\.\d{2})\n?$/); return before ? money(before[1]) : null; };
    const growth = (() => { const i = all.indexOf('Your investments have gone up in value by'); if (i < 0) return null; const m = all.slice(i).match(/\n(-?£[\d,]+\.\d{2})/); return m ? money(m[1]) : null; })();
    const fell = /Your investments have gone down in value by/.test(all);
    const charges = money((all.match(/Your plan costs and charges were (£[\d,]+\.\d{2})/) || [])[1] || '0');
    const payments = [...all.matchAll(/(\d{2})\/(\d{2})\/(\d{2}) (Regular|Single|Transfer|Employer|Employee)[^£\n]*(£[\d,]+\.\d{2})/g)].map(m => ({ date: `20${m[3]}-${m[2]}-${m[1]}`, type: m[4], amount: money(m[5]) }));
    const projection = all.match(/(£[\d,]+\.\d{2}) (£[\d,]+\.\d{2})\nyour plan’s value to buy income/);
    const retire = (all.match(/Planned Retirement date\n(?:.*\n)?(\d{1,2} [A-Za-z]+ \d{4})/) || [])[1] || '';
    if (!four) return { ok: false, problems: ['Aviva: could not read the pension values.'] };
    const r = { start: money(four[1]), paidIn: money(four[2]), paidOut: money(four[3]), end: money(four[4]) };
    const checks = {};
    if (growth !== null) checks.value = check('Pension value', r.start + r.paidIn - r.paidOut + (fell ? -growth : growth) - charges, r.end);
    checks.payments = check('Pension payments in', payments.reduce((s, p) => s + p.amount, 0), r.paidIn);
    return finish(Object.assign({ type: 'aviva', institution: 'Aviva pension', period, growth: fell ? -growth : growth, charges, payments, retirementDate: retire,
      projectedPot: projection ? money(projection[1]) : null, projectedIncome: projection ? money(projection[2]) : null, checks, txns: [] }, r));
  }

  // ---------------------------------------------------------------- dispatcher
  /** Work out what a statement is from its text, then read it. */
  function readStatement(pages, name) {
    const lines = FP.toLines(pages);
    const all = lines.map(l => l.text).join('\n');
    if (all.replace(/\s/g, '').length < 40) return { type: 'unreadable', ok: false, problems: ['This PDF is a scanned picture with no text in it, so it cannot be read. Download a fresh copy from the bank’s website and put it in the folder.'] };
    let r;
    if (/American Express/.test(all) && /Statement Period/.test(all)) r = parseAmex(lines);
    else if (/CLUBCARD Credit Card|Tesco Bank/i.test(all) && /Statement date/.test(all)) r = parseTesco(lines);
    else if (/Santander/.test(all) && /Your transactions/.test(all) && /account summary for/i.test(all)) {
      r = FP.parseSantander(pages, name); r.type = 'santander'; r.institution = 'Santander';
      const an = all.match(/Account number:\s*(\d{4,})/);
      r.account = { id: an ? 'santander-' + an[1].slice(-4) : 'santander', bank: 'Santander', last4: an ? an[1].slice(-4) : '' };
      (r.txns || []).forEach(t => { t.accId = r.account.id; });
      (r.txns || []).forEach(t => { t.account = 'Joint account'; t.holder = 'Joint'; t.type = 'bank'; });
    }
    else if (/Pay Day \d{2}\/\d{2}\/\d{4}/.test(all) && /Total Earnings/.test(all)) r = parsePayslip(lines);
    else if (/MFM Investment|Moneyfarm|moneyfarm/.test(all) && /Account statement produced for/i.test(all)) r = parseMoneyfarm(lines);
    else if (/Aviva/.test(all) && /Value of your pension/.test(all)) r = parseAviva(lines);
    else if (/annual mortgage statement/i.test(all)) return { type: 'unsupported', ok: false, problems: ['Mortgage statement: not read in this version.'] };
    else {
      // Statement types added as separate plug-in files (readers/*.js). Only tried when none of the readers above matched.
      const plug = (root.FinPlugins || []).find(p => p.detect(all));
      if (!plug) return { type: 'unsupported', ok: false, problems: ['Not a statement this app reads.'] };
      r = plug.read(lines, name);
    }
    r.name = name;
    (r.txns || []).forEach(t => { t.source = name; t.institution = r.institution; });
    return r;
  }

  const api = { readStatement, parseAmex, parseTesco, parsePayslip, parseMoneyfarm, parseAviva, cleanMerchant };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FinReaders = api;
})(typeof self !== 'undefined' ? self : this);
