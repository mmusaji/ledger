/* Generic reader for the documents that are not lists of transactions: payslips, savings/ISA statements and pension statements.
 * It knows no employer or provider. It (1) works out WHAT the document is from its words, (2) finds the labelled figures,
 * (3) PROVES them with the document's own arithmetic, and says how sure it is:
 *   verified    the printed figures agree with each other to the penny (payslip: gross - deductions = net;
 *               savings/pension: opening + paid in - paid out + growth - charges = closing)
 *   unverified  figures were found but nothing could prove them (the app asks you to confirm or type the rest)
 *   failed      the figures disagree, or this is not a document of that kind (nothing is kept)
 * Money is whole pence. Dates are day-first (UK) and returned as yyyy-mm-dd. Everything is treated as text.
 * Input: lines = [{ text }] (from parser.toLines). Output shapes are documented next to each reader.
 * Used by the importer (js/pipeline.js) after the specific readers; test with tests/income.test.js.
 */
(function (root) {
  'use strict';
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const pad = n => String(n).padStart(2, '0');

  // ---------------------------------------------------------------- money and dates
  const AMT = '-?\\(?(?:£\\s?\\d[\\d,]*(?:\\.\\d{2})?|\\d[\\d,]*\\.\\d{2})\\)?-?';
  /** '£1,234.50' | '(12.00)' | '12.00-' | '-£5' -> pence, or null. A bare whole number is not money (it could be a year or an id). */
  function pence(s) {
    s = String(s).trim(); if (!new RegExp('^' + AMT + '$').test(s)) return null;
    const neg = /^-|^\(|-$/.test(s); const v = Math.round(parseFloat(s.replace(/[^\d.]/g, '')) * 100);
    return Number.isFinite(v) ? (neg ? -v : v) : null;
  }
  const DATE = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})\b|\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b|\b(\d{4})-(\d{2})-(\d{2})\b/g;
  function mkDate(y, m, d) { y = +y; m = +m; d = +d; if (y < 100) y += 2000; if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null; const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null; }
  /** Every date in a piece of text, with where it was found. Day-first; a numeric date with a month over 12 is not a date. */
  function datesIn(text) {
    const out = []; let m; DATE.lastIndex = 0;
    while ((m = DATE.exec(text))) {
      let iso = null;
      if (m[1]) iso = mkDate(m[3], m[2], m[1]);
      else if (m[5]) { const mm = MONTHS[m[5].slice(0, 3).toLowerCase()]; iso = mm ? mkDate(m[6], mm, m[4]) : null; }
      else iso = mkDate(m[7], m[8], m[9]);
      if (iso) out.push({ iso, at: m.index, end: m.index + m[0].length });
    }
    return out;
  }
  const check = (name, got, want, tol = 0) => ({ ok: Math.abs(got - want) <= tol, name, got, want });

  // ---------------------------------------------------------------- labelled figures
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const PAIR = new RegExp("([A-Za-z][A-Za-z0-9 ()&'\\/.,%-]*?)\\s*:?\\s{1,}(" + AMT + ')(?=\\s|$)', 'g');
  /** All "label amount" pairs on a line, in order (a two-column table gives several). */
  function pairsOf(text) { const out = []; let m; PAIR.lastIndex = 0; while ((m = PAIR.exec(text))) { const a = pence(m[2]); if (a !== null) out.push({ label: norm(m[1]), raw: m[1].trim(), amount: a }); } return out; }
  const amountsOf = text => { const out = []; const re = new RegExp(AMT, 'g'); let m; while ((m = re.exec(text))) { const a = pence(m[0]); if (a !== null) out.push(a); } return out; };

  /** Pairs from the whole document. A row of labels with a row of amounts above or below it (a summary table) is paired up too. */
  function figures(lines, roleOf) {
    const out = [];
    lines.forEach((l, i) => {
      pairsOf(l.text).forEach(p => out.push(Object.assign(p, { line: i })));
      if (!roleOf || amountsOf(l.text).length) return;
      // a label on one line with its amount alone on the next ("Your plan costs and charges were" / "£25.00")
      const nx = lines[i + 1] && lines[i + 1].text.trim(), lone = nx ? pence(nx) : null;
      if (lone !== null && roleOf(norm(l.text))) { out.push({ label: norm(l.text), raw: l.text.trim(), amount: lone, line: i }); return; }
      const labels = headerLabels(l.text);
      if (labels.length >= 2) {
        for (const j of [i - 1, i + 1]) {
          const a = lines[j] && lines[j].text; const am = a ? amountsOf(a) : [];
          if (am.length === labels.length && !pairsOf(a).length) {
            labels.forEach((lb, k) => out.push({ label: labels.indexOf(lb) !== k ? 'closing value' : lb, raw: lb, amount: am[k], line: j })); // a repeated label is the closing one
            break;
          }
        }
      }
    });
    return out;
  }
  /** Split a header row such as "Value of your pension Money paid in Money paid out Value of your pension" into its labels. */
  function headerLabels(text) {
    const t = norm(text); const found = [];
    const phrases = HEADER_PHRASES.slice().sort((a, b) => b.length - a.length);
    let rest = t, pos = 0;
    while (rest.length) {
      const hit = phrases.find(p => rest.startsWith(p));
      if (hit) { found.push(hit); rest = rest.slice(hit.length).trim(); } else { const sp = rest.indexOf(' '); if (sp < 0) return []; rest = rest.slice(sp + 1); if (found.length === 0 && ++pos > 3) return []; }
    }
    return found;
  }
  const HEADER_PHRASES = ['value of your pension', 'money paid in', 'money paid out', 'opening balance', 'closing balance', 'starting value', 'closing value', 'paid in', 'paid out', 'money in', 'money out', 'contributions', 'withdrawals', 'growth', 'charges', 'fees'];

  // ---------------------------------------------------------------- what is this document?
  const SIGNS = {
    payslip: [[/\bpay ?slip\b|\bpayslip\b|\bwage slip\b|\bpayroll\b/i, 3], [/\bnet (pay|wage|salary)\b|\btake[- ]?home\b/i, 3], [/\bgross (pay|earnings|salary|wage)\b|\btotal gross\b|\btotal (earnings|payments)\b/i, 2], [/\bpaye\b|\btax code\b|\bni (number|no)\b|\bnational insurance\b/i, 2], [/\bytd\b|\byear to date\b|\brunning totals\b|\bthis employment\b/i, 1], [/\btotal deductions\b/i, 2]],
    savings: [[/\bisa\b|individual savings account|stocks? (and|&) shares|\bjunior isa\b|\bjisa\b|lifetime isa|general investment account|\bgia\b/i, 4], [/isa allowance|allowance (used|remaining|left)/i, 2], [/investment returns?|investment growth|\bdividends?\b|portfolio value|\bvaluation\b/i, 2], [/savings account|\baer\b|gross rate|\bsaver\b/i, 1], [/opening (balance|value)|closing (balance|value)|starting value/i, 1]],
    pension: [[/\bpension\b|\bsipp\b|retirement|annuity/i, 3], [/employer contribution|employee contribution|your contributions|planned retirement|retirement date|projected? (value|pot|income)/i, 3], [/value of your (pension|plan|pot)|pension (pot|value)|plan value/i, 3], [/workplace|\bnest\b|\bnow: pensions\b/i, 1]],
    bank: [[/sort code/i, 3], [/opening balance|closing balance|balance (brought|carried) forward/i, 2], [/(paid|payments?|money) (in|out)|\bdebits?\b|\bcredits?\b|\bstatement of account\b/i, 1], [/current account|\bcheque\b|account number|\biban\b/i, 1]],
    card: [[/credit limit|minimum payment|\bapr\b|statement balance|payment due|new balance|card number/i, 3], [/american express|clubcard|mastercard|\bvisa\b/i, 1], [/credit card|purchases|cash advances/i, 1]],
    other: [[/mortgage|\bloan agreement\b|\binsurance\b|\bcertificate\b|\binvoice\b/i, 2]]
  };
  /** { kind: 'payslip'|'savings'|'pension'|'bank'|'card'|'other'|'unknown', score, why: [...] } */
  function classify(text) {
    const score = {}, why = {};
    Object.keys(SIGNS).forEach(k => { score[k] = 0; why[k] = []; SIGNS[k].forEach(([re, w]) => { const m = String(text).match(re); if (m) { score[k] += w; why[k].push(m[0].toLowerCase()); } }); });
    // A payslip names a pension and a savings plan; it is a payslip when it has its own words and a net pay figure.
    const hasNet = /\bnet (pay|wage|salary)\b|\btake[- ]?home\b|\bamount paid\b/i.test(text);
    const ranked = Object.keys(score).sort((a, b) => score[b] - score[a]);
    let kind = ranked[0];
    if (score.payslip >= 5 && hasNet && score.bank < 3) kind = 'payslip';
    // a card statement says so in words a bank statement does not; it may also quote a sort code to pay by transfer
    if (/credit limit|minimum payment|\bapr\b|new balance|payment due/i.test(text) && score.card >= 4 && score.card >= score.bank - 1 && kind === 'bank') kind = 'card';
    if (score[kind] < 3) kind = 'unknown';
    return { kind, score: score[kind] || 0, why: why[kind] || [], scores: score };
  }

  // ---------------------------------------------------------------- payslip
  const ROLE_PAYSLIP = [
    ['gross', /^(total )?gross( pay| earnings| salary| wage| payments?)?$|^total (earnings|payments|pay)$|^gross total$|^total gross pay$/],
    ['totalDeductions', /^total deductions?$|^deductions total$|^total of deductions$/],
    ['net', /^net( pay| wage| salary| amount| payment)?$|^take ?home( pay)?$|^amount paid$|^nett( pay)?$|^pay(ment)? to bank$|^net paid$/],
    ['tax', /^(income )?tax( paid| deducted)?$|^paye( tax| income tax)?$|^tax deducted$/],
    ['ni', /^(employee s? )?(national insurance|ni)( contributions?)?( employee)?$|^employees? ni$|^nic$/],
    ['pensionEmployer', /employer.*(pension|contribution)|(pension|contribution).*employer|\ber pension\b/],
    ['pensionEmployee', /pension|\bavc\b|salary sacrifice|\bnest\b|\bscheme\b|\bpse\b/],
    ['studentLoan', /student loan|\bslc\b|postgrad|\bpgl\b/]
  ];
  const roleOfPayslip = label => { const hit = ROLE_PAYSLIP.find(([, re]) => re.test(label)); return hit ? hit[0] : null; };
  // heading that starts the year-to-date block: figures after it are totals for the year, not for this pay
  const YTD_HEAD = /^(year to date|ytd|running totals|cumulative|this employment|tax year to date|totals? to date|year to date totals)/i;
  const PAY_DATE_LABEL = [[/pay(ment)? date|date paid|pay ?day|paid on|date of payment/i, 3], [/period (ending|end)|pay period end|week ending|month ending|for (the )?period/i, 2]];

  /** type 'payslip': { payDate, gross, tax, ni, pensionEmployee, pensionEmployer, studentLoan, otherDeductions, totalDeductions, net, grossBeforePension,
   *                    items:[{label,amount,role}], checks, confidence, source:'generic', txns:[] } */
  function readPayslip(lines) {
    const texts = lines.map(l => l.text);
    const cut = texts.findIndex(t => YTD_HEAD.test(t.trim())); const period = cut > 0 ? lines.slice(0, cut) : lines;
    const all = texts.join('\n');
    // pay date: the date nearest a pay-date label; failing that, the only date there is
    let payDate = null;
    for (const [re] of PAY_DATE_LABEL) {
      for (let i = 0; i < period.length && !payDate; i++) {
        const t = period[i].text, m = t.match(re); if (!m) continue;
        const after = datesIn(t.slice(m.index)).concat(datesIn((period[i + 1] || { text: '' }).text));
        if (after.length) payDate = after[0].iso;
      }
      if (payDate) break;
    }
    if (!payDate) { const ds = [...new Set(datesIn(all).map(d => d.iso))]; if (ds.length === 1) payDate = ds[0]; }
    const figs = figures(period, roleOfPayslip);
    const by = role => figs.filter(f => roleOfPayslip(f.label) === role);
    const first = role => { const f = by(role)[0]; return f ? Math.abs(f.amount) : null; };
    const gross = by('gross').map(f => f.amount), tded = by('totalDeductions').map(f => Math.abs(f.amount)), net = by('net').map(f => f.amount);
    const out = { type: 'payslip', source: 'generic', txns: [], items: [], payDate, period: payDate ? { start: payDate, end: payDate } : null, checks: {}, problems: [] };
    if (!payDate) out.problems.push('No pay date found.');
    if (!net.length) { out.confidence = 'failed'; out.ok = false; out.problems.push('No net pay found.'); return out; }
    // the proof: some printed gross minus some printed total of deductions is exactly some printed net
    let hit = null;
    gross.forEach(g => tded.forEach(d => net.forEach(n => { if (!hit && g - d === n) hit = { g, d, n }; })));
    out.net = hit ? hit.n : net[0];
    out.tax = first('tax'); out.ni = first('ni'); out.studentLoan = first('studentLoan');
    out.pensionEmployee = first('pensionEmployee'); out.pensionEmployer = first('pensionEmployer');
    out.items = figs.filter(f => roleOfPayslip(f.label)).map(f => ({ label: f.raw, amount: f.amount, role: roleOfPayslip(f.label) }));
    if (hit) {
      out.gross = hit.g; out.totalDeductions = hit.d;
      // pension taken as a deduction is part of the total; one taken off the gross already (salary sacrifice) is not
      const known = (out.tax || 0) + (out.ni || 0) + (out.studentLoan || 0);
      const withPen = known + (out.pensionEmployee || 0);
      out.pensionInDeductions = out.pensionEmployee != null && withPen <= hit.d;
      out.grossBeforePension = out.pensionInDeductions || out.pensionEmployee == null ? hit.g : hit.g + out.pensionEmployee;
      out.otherDeductions = Math.max(0, hit.d - known - (out.pensionInDeductions ? out.pensionEmployee || 0 : 0));
      out.checks.net = check('Payslip: gross − deductions = net', hit.g - hit.d, hit.n);
      out.confidence = 'verified'; out.ok = true;
    } else if (gross.length && tded.length) {
      out.gross = gross[0]; out.totalDeductions = tded[0];
      out.checks.net = check('Payslip: gross − deductions = net', gross[0] - tded[0], net[0]);
      out.confidence = 'failed'; out.ok = false; out.problems.push('The printed gross, deductions and net pay do not agree.');
    } else {
      // only a net pay (and maybe some items): read, but nothing proves it
      out.gross = gross[0] != null ? gross[0] : null; out.totalDeductions = tded[0] != null ? tded[0] : null; out.grossBeforePension = out.gross;
      out.confidence = 'unverified'; out.ok = false; out.problems.push('Found net pay but not the gross and total deductions, so it cannot be checked.');
    }
    return out;
  }

  // ---------------------------------------------------------------- savings and pensions
  const ROLE_FUND = [
    ['opening', /^(opening|starting|start|beginning|previous|brought forward)( (balance|value))?$|^(balance|value) (brought forward|at start|at the start|at beginning)$|^(balance|value) at (start|opening)$|^value at \d|^starting value at$|^value of your (pension|plan|pot|savings)$/],
    ['closing', /^(closing|ending|end|current|new)( (balance|value))?$|^(balance|value) (carried forward|at end|at the end)$|^(total )?(balance|value|valuation|portfolio value)$|^amount in an isa wrapper at$|^value at (end|close)|^closing value at$|^total value$/],
    ['in', /^(total )?(contributions?|deposits?|subscriptions?|payments? in|money in|paid in|transfers? in|credits?|money paid in)( this (year|period))?$|^bank input$|^total paid in$|^contributions (received|paid)$/],
    ['out', /^(total )?(withdrawals?|payments? out|money out|paid out|transfers? out|debits?|money paid out)( this (year|period))?$|^bank output$|^total paid out$/],
    ['growth', /^(investment )?(growth|returns?|gains?|growth and returns?|interest( paid| earned| added)?|dividends?|profit|investment returns?( in the period)?)$|gone (up|down) in value by$|^investment returns in the period$|^change in value$/],
    ['charges', /^(plan |account |total )?(costs and charges|charges|fees|costs|expenses|fees charged( to your isa account in the (period|quarter))?)$|^your plan costs and charges were$|^fees charged to your/]
  ];
  const roleOfFund = label => { const hit = ROLE_FUND.find(([, re]) => re.test(label)); return hit ? hit[0] : null; };
  const PERIOD_RE = /(?:from|period|statement for|between|dated)\D{0,20}?((?:\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})|(?:\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4})|(?:\d{4}-\d{2}-\d{2}))\s*(?:to|-|–|until|and)\s*((?:\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})|(?:\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4})|(?:\d{4}-\d{2}-\d{2}))/i;
  function periodOf(all) {
    const m = all.replace(/\n/g, ' ').match(PERIOD_RE);
    if (m) { const a = datesIn(m[1])[0], b = datesIn(m[2])[0]; if (a && b && a.iso <= b.iso) return { start: a.iso, end: b.iso }; }
    return null;
  }
  const FUND_KIND = [['jisa', /junior isa|\bjisa\b/i], ['lisa', /lifetime isa|\blisa\b/i], ['isa', /\bisa\b|individual savings account/i], ['gia', /general investment account|\bgia\b/i], ['sipp', /\bsipp\b/i]];

  /** type 'savings' | 'pension': { kind, period, start, paidIn, paidOut, growth, charges, end, isaAllowanceLeft, checks, confidence, source:'generic', txns:[] }
   *  Proof: start + paidIn − paidOut + growth − charges = end, where every figure used is one the document printed. A document that
   *  prints only a closing value cannot be proved: it is 'unverified'. */
  /** Who issued the document, if it names one we know (earliest mention wins). Used only to suggest a name for the account. */
  const PROVIDERS = ['Vanguard', 'Trading 212', 'Moneyfarm', 'Aviva', 'Nutmeg', 'Hargreaves Lansdown', 'AJ Bell', 'Fidelity', 'Scottish Widows', 'Legal & General', 'Standard Life', 'Royal London', 'NEST', "The People's Pension", 'Interactive Investor', 'Freetrade', 'Wealthify', 'Moneybox', 'Plum', 'Chip', 'Penfold', 'Prudential', 'Aegon', 'Zurich', 'Cushon', 'Smart Pension', 'True Potential', 'Santander', 'Halifax', 'Barclays', 'Lloyds', 'Nationwide'];
  function providerOf(text) {
    let best = null;
    PROVIDERS.forEach(p => { const m = new RegExp('(^|[^A-Za-z])' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z])', 'i').exec(text); if (m && (best === null || m.index < best.i)) best = { i: m.index, p }; });
    return best ? best.p : '';
  }
  /** Only the last four digits of an account, plan or policy number, so two accounts with one provider stay apart. */
  function refOf(text) {
    const m = text.match(/(?:account|plan|policy|reference|membership)\s*(?:number|no\.?|ref\.?)?\s*[:#]\s*([A-Z0-9][A-Z0-9 \-]{4,22})/i);
    if (!m) return ''; const d = m[1].replace(/\D/g, ''); return d.length >= 4 ? d.slice(-4) : '';
  }

  function readFund(lines, docKind) {
    const all = lines.map(l => l.text).join('\n');
    const period = periodOf(all);
    const figs = figures(lines, roleOfFund);
    const vals = role => [...new Set(figs.filter(f => roleOfFund(f.label) === role).map(f => f.amount))];
    const out = { type: docKind, source: 'generic', txns: [], period, checks: {}, problems: [] };
    out.provider = providerOf(all); out.ref = refOf(all);
    const k = FUND_KIND.find(([, re]) => re.test(all)); out.kind = k ? k[0] : (docKind === 'pension' ? 'workplace' : 'savings');
    const op = vals('opening'), cl = vals('closing'), inn = vals('in'), ou = vals('out'), gr = vals('growth'), ch = vals('charges');
    const allow = all.match(/(?:remaining|unused|left)\s+(?:isa\s+)?allowance[^£\d-]{0,20}(£[\d,]+(?:\.\d{2})?)/i); out.isaAllowanceLeft = allow ? pence(allow[1]) : null;
    if (!period) out.problems.push('No statement period found.');
    if (!cl.length) { out.confidence = 'failed'; out.ok = false; out.problems.push('No closing value found.'); return out; }
    // growth may be printed as a positive "gone up by" or negative "gone down by"
    const down = /gone down in value by/i.test(all); const grow = gr.map(g => (down && g > 0 ? -g : g));
    const opts = a => (a.length ? a.concat([0]) : [0]);
    // rounding: a statement printing whole pounds is allowed £1 either way per figure (Moneyfarm prints rounded figures)
    const whole = !/\d\.\d{2}\b/.test(all.replace(/£?\d{4}-\d{2}-\d{2}/g, '')); const tol = whole ? 200 : 0;
    let hit = null;
    if (op.length) for (const o of op) for (const c of cl) for (const i of opts(inn)) for (const x of opts(ou.map(Math.abs))) for (const g of opts(grow)) for (const h of opts(ch.map(Math.abs)))
      if (!hit && Math.abs(o + i - x + g - h - c) <= tol) hit = { o, c, i, x, g, h };
    if (hit) {
      Object.assign(out, { start: hit.o, end: hit.c, paidIn: hit.i, paidOut: hit.x, growth: hit.g, charges: hit.h });
      out.checks.value = check('Value: opening + in − out + growth − charges = closing', hit.o + hit.i - hit.x + hit.g - hit.h, hit.c, tol);
      out.confidence = period ? 'verified' : 'unverified'; out.ok = out.confidence === 'verified'; if (!period) out.problems.push('The figures add up but no statement dates were found.');
    } else {
      Object.assign(out, { start: op[0] != null ? op[0] : null, end: cl[0], paidIn: inn[0] != null ? inn[0] : null, paidOut: ou[0] != null ? Math.abs(ou[0]) : null, growth: grow[0] != null ? grow[0] : null, charges: ch[0] != null ? Math.abs(ch[0]) : null });
      if (op.length && (inn.length || ou.length || gr.length || ch.length)) { out.confidence = 'failed'; out.ok = false; out.problems.push('The printed opening value, movements and closing value do not add up.'); }
      else { out.confidence = 'unverified'; out.ok = false; out.problems.push('Found a value but nothing to check it against.'); }
    }
    return out;
  }

  /** Classify, then read with the matching reader. Returns { kind, class, result } (result is null when it is not one of these documents). */
  function read(lines) {
    const all = lines.map(l => l.text).join('\n'); const cls = classify(all);
    let result = null;
    if (cls.kind === 'payslip') result = readPayslip(lines);
    else if (cls.kind === 'savings') result = readFund(lines, 'savings');
    else if (cls.kind === 'pension') result = readFund(lines, 'pension');
    return { kind: cls.kind, class: cls, result };
  }

  const api = { classify, read, readPayslip, readFund, pence, datesIn, pairsOf, periodOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FinIncome = api;
})(typeof self !== 'undefined' ? self : this);
