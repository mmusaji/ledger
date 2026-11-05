#!/usr/bin/env node
/* Test harness for readers/csv.js.
 *   node tools/csv-eval.js [fixtures-dir] [--regen] [--details] [--json out.json] [--only text]
 * With no folder it (re)generates the synthetic fixtures (tests/csv/make_fixtures.js) and runs them against expected.json.
 * With a folder of REAL exports and no expected.json it just reads each file and reports (counts and totals only; --details adds rows).
 *
 * Outcomes per synthetic fixture:
 *   PASS             exactly what was expected
 *   FALSE-VERIFIED   a file that must be refused (or whose data is wrong) was called "verified"            <- must always be 0
 *   WRONG-DATA       accepted, but the transactions are not the expected ones                              <- must always be 0
 *   ACCEPTED-BAD     a file that must be refused was accepted as "unverified" instead                      <- must always be 0
 *   REJECTED-VALID   a good file was refused                                                               <- the cost side: keep as low as possible
 *   DOWNGRADED       a good file with a balance was read right but only "unverified"
 *   UPGRADED         a file expected "unverified" came back "verified" (check why)
 *   known            documented gaps, listed separately and never counted as failures
 */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.resolve(__dirname, '..');
const CSV = require(path.join(root, 'readers/csv.js'));
const args = process.argv.slice(2);
const flag = (n, v) => { const i = args.indexOf(n); if (i < 0) return v ? null : false; if (v) { const x = args[i + 1]; args.splice(i, 2); return x; } args.splice(i, 1); return true; };
const details = flag('--details'), jsonOut = flag('--json', true), only = flag('--only', true), regen = flag('--regen');
let dir = args[0];
const gbp = p => p == null ? '—' : (p < 0 ? '-' : '') + '£' + (Math.abs(p) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 });
if (!dir) {
  dir = path.join(root, 'tests/csv/fixtures');
  if (regen || !fs.existsSync(path.join(dir, 'expected.json'))) cp.execFileSync(process.execPath, [path.join(root, 'tests/csv/make_fixtures.js'), '--out', dir], { stdio: 'inherit' });
}
const expFile = path.join(dir, 'expected.json'); const expected = fs.existsSync(expFile) ? JSON.parse(fs.readFileSync(expFile, 'utf8')) : null;
const files = fs.readdirSync(dir).filter(f => /\.(csv|txt)$/i.test(f)).sort().filter(f => !only || f.includes(only));
const keyOf = t => t[0] + '|' + t[1];
const sameTxns = (exp, got) => { const m = new Map(); exp.forEach(t => m.set(keyOf(t), (m.get(keyOf(t)) || 0) + 1)); let extra = 0; got.forEach(t => { const k = t.date + '|' + t.amount; const c = m.get(k); if (c) m.set(k, c - 1); else extra++; }); return { missing: [...m.values()].reduce((s, v) => s + v, 0), extra }; };
const rows = [];
for (const f of files) {
  const id = f.replace(/\.(csv|txt)$/i, ''), bytes = fs.readFileSync(path.join(dir, f));
  const t0 = process.hrtime.bigint(); let res, crash = null;
  try { res = CSV.read(new Uint8Array(bytes), f); } catch (e) { crash = e; res = { confidence: 'crash', txns: [], problems: [e.message], notes: [] }; }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const rec = { id, confidence: res.confidence, n: res.txns.length, ms: +ms.toFixed(1), problems: res.problems, notes: res.notes, convention: res.convention };
  const ex = expected && expected[id];
  if (crash) rec.outcome = 'CRASH';
  else if (ex) {
    const d = ex.txns ? sameTxns(ex.txns, res.txns) : null; const right = d && d.missing === 0 && d.extra === 0 && res.txns.length === ex.txns.length;
    if (ex.expect === 'fail') rec.outcome = res.confidence === 'failed' ? 'PASS' : res.confidence === 'verified' ? 'FALSE-VERIFIED' : 'ACCEPTED-BAD';
    else if (res.confidence === 'failed') rec.outcome = 'REJECTED-VALID';
    else if (!right) rec.outcome = res.confidence === 'verified' ? 'FALSE-VERIFIED' : 'WRONG-DATA';
    else if (ex.expect === 'verified') rec.outcome = res.confidence === 'verified' ? 'PASS' : 'DOWNGRADED';
    else rec.outcome = res.confidence === 'unverified' ? 'PASS' : 'UPGRADED';
    if (d) { rec.missing = d.missing; rec.extra = d.extra; }
    if (ex.known) { rec.known = typeof ex.known === 'string' ? ex.known : ex.note; rec.outcomeRaw = rec.outcome; rec.outcome = 'known'; }
    rec.expect = ex.expect;
  }
  if (details) rec.lines = res.txns.slice(0, 40).map(t => `${t.date}  ${gbp(t.amount).padStart(12)}  ${(t.desc || '').slice(0, 50)}`);
  rows.push(rec);
}
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const bad = rows.filter(r => !expected ? false : !['PASS', 'known'].includes(r.outcome));
if (expected) {
  console.log(pad('fixture', 62), pad('expected', 11), pad('got', 11), pad('rows', 6), 'outcome');
  rows.filter(r => r.outcome !== 'PASS' || only).forEach(r => console.log(pad(r.id, 62), pad(r.expect, 11), pad(r.confidence, 11), pad(r.n, 6), r.outcome + (r.known ? ` (${r.outcomeRaw})` : '') + (r.outcome !== 'PASS' && r.problems && r.problems[0] ? '   ' + r.problems[0].slice(0, 70) : '')));
  const c = {}; rows.forEach(r => { c[r.outcome] = (c[r.outcome] || 0) + 1; });
  console.log('\n' + rows.length + ' fixtures: ' + Object.entries(c).map(([k, v]) => `${v} ${k}`).join(', '));
  const crit = ['FALSE-VERIFIED', 'WRONG-DATA', 'ACCEPTED-BAD', 'CRASH'].map(k => c[k] || 0).reduce((s, v) => s + v, 0);
  const worst = rows.slice().sort((a, b) => b.ms - a.ms)[0];
  console.log(`Safety (must be 0): ${crit}.  Good files refused: ${c['REJECTED-VALID'] || 0}.  Slowest file: ${worst.id} ${worst.ms} ms.`);
  if (crit) process.exitCode = 1;
} else {
  console.log(pad('file', 50), pad('result', 11), pad('rows', 6), pad('net', 14), 'notes');
  rows.forEach(r => { const g = r.n ? gbp(0) : ''; console.log(pad(r.id, 50), pad(r.confidence, 11), pad(r.n, 6), pad('', 14), (r.problems[0] || r.notes[0] || '').slice(0, 90)); if (details && r.lines) r.lines.forEach(l => console.log('      ' + l)); });
  const c = {}; rows.forEach(r => { c[r.confidence] = (c[r.confidence] || 0) + 1; });
  console.log('\n' + Object.entries(c).map(([k, v]) => `${v} ${k}`).join(', '));
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
