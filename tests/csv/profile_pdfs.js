#!/usr/bin/env node
/* Builds tests/csv/profile.json: ANONYMOUS statistics learned from real statement PDFs, so generated CSVs look like real ones.
 *   node tests/csv/profile_pdfs.js <folder-or-pdf>... [--out tests/csv/profile.json]
 * Only numbers leave the PDFs: row counts, the shape of the amounts (deciles), the share of money in, how many rows share a
 * day, and counts of a few generic bank words (DIRECT DEBIT, CARD PAYMENT, ...). No payee, no description, no balance, no date.
 * Only statements the generic PDF reader PROVED correct are used.
 */
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../..');
let pdfjs; try { pdfjs = require(path.join(root, 'vendor/pdf.min.js')); } catch (e) { pdfjs = require('pdfjs-dist/legacy/build/pdf.js'); }
if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = path.join(root, 'vendor/pdf.worker.min.js');
const SM = require(path.join(root, 'readers/smart.js'));
const _log = console.log; console.log = (...a) => { if (typeof a[0] === 'string' && /^Warning:/.test(a[0])) return; _log(...a); };
async function extractPages(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise; const pages = [];
  for (let n = 1; n <= doc.numPages; n++) { const page = await doc.getPage(n); const tc = await page.getTextContent(); pages.push(tc.items.map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }))); page.cleanup(); }
  await doc.destroy(); return pages;
}
const args = process.argv.slice(2); let outFile = path.join(__dirname, 'profile.json');
const oi = args.indexOf('--out'); if (oi >= 0) { outFile = args[oi + 1]; args.splice(oi, 2); }
const walk = p => fs.statSync(p).isFile() ? (/\.pdf$/i.test(p) ? [p] : []) : fs.readdirSync(p).sort().flatMap(f => walk(path.join(p, f)));
const WORDS = ['DIRECT DEBIT', 'CARD PAYMENT', 'FASTER PAYMENT', 'STANDING ORDER', 'TRANSFER', 'ATM', 'CASH', 'INTEREST', 'REFUND', 'SALARY', 'BGC', 'POS', 'DD', 'SO'];
// deciles 10%..90% only, rounded to 50p: the extremes (one-off large payments) are dropped because they could identify a real transaction
const dec = (arr) => { if (!arr.length) return []; const s = arr.slice().sort((a, b) => a - b); return Array.from({ length: 9 }, (_, i) => Math.round(s[Math.min(s.length - 1, Math.round((i + 1) / 10 * (s.length - 1)))] / 50) * 50 || 50); };
(async () => {
  const files = args.flatMap(walk); const rowsPer = [], outs = [], ins = [], sameDay = [], words = {}; let used = 0, creditCard = 0;
  for (const f of files) {
    const buf = fs.readFileSync(f); let res;
    try { res = SM.read(await extractPages(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)), path.basename(f)); } catch (e) { continue; }
    if (res.confidence !== 'verified' || !res.txns.length) continue;
    used++; rowsPer.push(res.txns.length);
    if (/card/.test(res.convention || '')) creditCard++;
    const days = {}; res.txns.forEach(t => { days[t.date] = (days[t.date] || 0) + 1; (t.amount < 0 ? outs : ins).push(Math.abs(t.amount)); const d = (t.desc || '').toUpperCase(); WORDS.forEach(w => { if (d.includes(w)) words[w] = (words[w] || 0) + 1; }); });
    sameDay.push(res.txns.length / Object.keys(days).length);
  }
  const profile = { statementsUsed: used, cardStatements: creditCard, rowsPerStatement: rowsPer.sort((a, b) => a - b), outDeciles: dec(outs), inDeciles: dec(ins), shareIn: ins.length / Math.max(1, ins.length + outs.length), rowsPerActiveDay: sameDay.reduce((s, v) => s + v, 0) / Math.max(1, sameDay.length), genericWords: words };
  fs.writeFileSync(outFile, JSON.stringify(profile, null, 1));
  console.log(`Profile from ${used} verified statement(s) written to ${outFile}`); console.log(JSON.stringify(profile));
})();
