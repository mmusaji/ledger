#!/usr/bin/env node
/* Experiment harness for the generic statement reader.
 *   node tools/smart-eval.js <folder-or-pdf>... [--details] [--json out.json] [--expect tests/smart/fixtures/expected.json]
 * For every PDF it runs (1) the app's existing reader and (2) the generic reader (readers/smart.js), then compares them.
 * Everything runs on this computer: the PDFs are only read, never copied or uploaded.
 * By default the report shows counts and totals only (no payees); --details adds transaction lines.
 */
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
let pdfjs; try { pdfjs = require(path.join(root, 'vendor/pdf.min.js')); } catch (e) { pdfjs = require('pdfjs-dist/legacy/build/pdf.js'); }
if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = path.join(root, 'vendor/pdf.worker.min.js');
const P = require(path.join(root, 'parser.js'));
const RD = require(path.join(root, 'readers.js'));
require(path.join(root, 'readers/monzo.js'));
const SM = require(path.join(root, 'readers/smart.js'));

const _log = console.log; console.log = (...a) => { if (typeof a[0] === 'string' && /^Warning:/.test(a[0])) return; _log(...a); };
const args = process.argv.slice(2);
const flag = (n, v) => { const i = args.indexOf(n); if (i < 0) return v ? null : false; if (v) { const x = args[i + 1]; args.splice(i, 2); return x; } args.splice(i, 1); return true; };
const details = flag('--details'), jsonOut = flag('--json', true), expectFile = flag('--expect', true);
const expect = expectFile ? JSON.parse(fs.readFileSync(expectFile, 'utf8')) : {};
const gbp = p => p == null ? '—' : (p < 0 ? '-' : '') + '£' + (Math.abs(p) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 });
function walk(p) { const st = fs.statSync(p); if (st.isFile()) return /\.pdf$/i.test(p) ? [p] : []; return fs.readdirSync(p).sort().flatMap(f => walk(path.join(p, f))); }
const files = args.flatMap(walk);
if (!files.length) { console.log('Usage: node tools/smart-eval.js <folder-or-pdf>... [--details] [--json out.json] [--expect expected.json]'); process.exit(1); }

const key = t => t.date + '|' + t.amount;
function sameTxns(a, b) { const m = new Map(); a.forEach(t => m.set(key(t), (m.get(key(t)) || 0) + 1)); let miss = 0; b.forEach(t => { const c = m.get(key(t)); if (c) m.set(key(t), c - 1); else miss++; }); const left = [...m.values()].reduce((s, v) => s + v, 0); return { onlyA: left, onlyB: miss }; }

(async () => {
  const rows = [];
  for (const f of files) {
    const name = path.basename(f), rec = { file: name };
    try {
      const buf = fs.readFileSync(f);
      const pages = await P.extractPages(pdfjs, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      let base = null; try { base = RD.readStatement(pages, name); } catch (e) { base = { type: 'error', problems: [e.message], txns: [] }; }
      const sm = SM.read(pages, name);
      const bt = base.txns || [], st = sm.txns || [];
      Object.assign(rec, {
        baseline: { type: base.type, ok: !!base.ok, n: bt.length, net: bt.reduce((s, t) => s + t.amount, 0) },
        smart: { ok: sm.ok, confidence: sm.confidence, n: st.length, net: st.reduce((s, t) => s + t.amount, 0), columns: sm.columns, convention: sm.convention, period: sm.period, checks: Object.fromEntries(Object.entries(sm.checks || {}).map(([k, v]) => [k, v.msg && !v.ok ? v.msg : (v.ok ? 'ok' : 'n/a')])), problems: sm.problems, notes: sm.notes },
      });
      if (bt.length) { const d = sameTxns(bt, st); rec.agree = d.onlyA === 0 && d.onlyB === 0 ? 'identical' : `differs (${d.onlyA} only in app reader, ${d.onlyB} only in generic)`; }
      else rec.agree = base.type === 'unsupported' || base.type === 'unreadable' ? 'app has no reader for this' : 'n/a';
      const ex = expect[name.replace(/\.pdf$/i, '')];
      if (ex && ex.txns) { const d = sameTxns(ex.txns.map(([date, amount]) => ({ date, amount })), st); rec.expected = d.onlyA === 0 && d.onlyB === 0 && sm.ok ? 'PASS' : `FAIL (missing ${d.onlyA}, extra ${d.onlyB}, ${sm.confidence})`; }
      else if (ex && ex.expect) rec.expected = (ex.expect === 'not verified' && !sm.ok) || (ex.expect === 'no table' && !st.length && !sm.ok) ? 'PASS' : 'FAIL (should not verify)';
      if (details) rec.lines = st.map(t => `${t.date}  ${gbp(t.amount).padStart(12)}  ${t.desc.slice(0, 50)}`);
    } catch (e) { rec.error = e.message; }
    rows.push(rec);
  }
  // report
  const pad = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(pad('file', 44), pad('app reader', 16), pad('generic', 12), pad('txns app/gen', 13), 'compare');
  rows.forEach(r => {
    if (r.error) return console.log(pad(r.file, 44), 'ERROR', r.error);
    console.log(pad(r.file, 44), pad(r.baseline.type + (r.baseline.ok ? ' ✓' : ' ✗'), 16), pad(r.smart.confidence, 12), pad(r.baseline.n + '/' + r.smart.n, 13), r.expected || r.agree);
    if (details) { console.log('     columns:', (r.smart.columns || []).join(' | '), '· convention:', r.smart.convention || '—', '· checks:', JSON.stringify(r.smart.checks)); (r.smart.problems || []).forEach(p => console.log('     problem:', p)); (r.lines || []).forEach(l => console.log('       ' + l)); }
  });
  const gen = rows.filter(r => r.smart);
  const sum = { files: rows.length, verified: gen.filter(r => r.smart.confidence === 'verified').length, unverified: gen.filter(r => r.smart.confidence === 'unverified').length, failed: gen.filter(r => r.smart.confidence === 'failed').length };
  const cmp = rows.filter(r => r.agree && /identical|differs/.test(r.agree));
  console.log(`\nGeneric reader: ${sum.verified} proved correct, ${sum.unverified} read but unprovable, ${sum.failed} failed, of ${sum.files} PDFs.`);
  if (cmp.length) console.log(`Where the app already has a reader: ${cmp.filter(r => r.agree === 'identical').length} of ${cmp.length} give identical transactions.`);
  const ex = rows.filter(r => r.expected); if (ex.length) console.log(`Known-answer fixtures: ${ex.filter(r => r.expected === 'PASS').length} of ${ex.length} pass.`);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows.map(r => Object.assign({}, r, { lines: undefined })), null, 1));
  if (ex.some(r => r.expected !== 'PASS')) process.exitCode = 1;
})();
