/* Tap a statement on the Statements screen: what the app knows about it, what it does to the figures, and what you can do. */
import { askAccount } from './accountsheet.js';
import { MARK_TEXT } from './pipeline.js';
import { applyChoice } from './book.js';
import { rebuild } from './model.js';
import { S } from './state.js';
import { render, toast } from './ui.js';
import { $, esc, gbp, nice, store } from './util.js';
import { saveVault } from './vault.js';

const MONEY = ['santander', 'amex', 'tesco', 'monzo'];
const span = p => !p ? '' : p.start === p.end ? nice(p.end) : nice(p.start) + ' – ' + nice(p.end);
const close = () => { S.sheetLocked = false; $('#sheet').close(); };
const show = html => { S.sheetLocked = false; $('#sheet-body').innerHTML = html; if (!$('#sheet').open) $('#sheet').showModal(); };

/** What this statement would add to (or take out of) the figures, worked from the saved lines. */
export function impactOf(id) {
  const e = S.files[id]; const r = e && e.result; if (!r) return null;
  const tx = r.txns || [];
  const into = tx.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0), out = tx.filter(t => t.amount < 0).reduce((s, t) => s - t.amount, 0);
  const months = [...new Set(tx.map(t => t.date.slice(0, 7)))].sort();
  let diff = null;
  if ((r.type === 'santander' || r.type === 'monzo') && Number.isFinite(r.opening) && Number.isFinite(r.closing)) diff = r.closing - r.opening - tx.reduce((s, t) => s + t.amount, 0);
  return { n: tx.length, into, out, months, diff };
}

const monthName = m => nice(m + '-01').replace(/^1 /, '');

export function marksHelp() {
  show(`<div class="stack"><b style="font-size:17px">What the marks mean</b>
    <div class="card small"><b class="in" style="font-size:18px">✓</b> <b>Checked.</b> The statement's own numbers add up: a PDF's totals match, or a CSV's running balance follows every row. The figures can be trusted.</div>
    <div class="card small"><b class="muted" style="font-size:18px">○</b> <b>Read, not checked.</b> A CSV with no balance column. The app read every row, but there is nothing in the file to prove them right. It is counted in your figures. Wrong dates or signs would be possible but unlikely.</div>
    <div class="card small"><b class="out" style="font-size:18px">⚠</b> <b>Does not add up.</b> A PDF that was read but its totals do not match what the bank printed. Tap it to see the difference, what it does to your figures, and to keep it, leave it out or remove it.</div>
    <p class="small muted" style="margin:0">A file that cannot be read at all is never saved, so it never shows a mark: you see it in the import result instead.</p>
    <div class="row"><button class="btn" id="mh-ok">Done</button></div></div>`);
  $('#mh-ok').onclick = close;
}

export function openStatement(id) {
  const s = S.statements.find(x => x.id === id); const e = S.files[id]; if (!s || !e) return;
  if (s.type === 'csv') return openCsv(s, e);
  if (MONEY.includes(s.type) && (!s.ok || s.held || s.acked)) return openReview(s);
}

function openCsv(s, e) {
  const c = s.csv; const ov = S.overlap && S.overlap[s.id]; const mark = c.mark;
  show(`<div class="stack"><b style="font-size:17px">${esc(s.name)}</b>
    <div class="card small"><span class="muted">Account</span><br><b>${c.acct ? esc(c.acct.name) : 'Not named yet'}</b>${c.acct ? ' · ' + (c.acct.kind === 'card' ? 'credit card' : 'current account' + (c.acct.role ? ', ' + c.acct.role : '')) : '<br><span class="muted">Waiting: its transactions are not in your figures until you name the account.</span>'}</div>
    <div class="card small"><span class="muted">${esc(span(s.period))} · ${s.count} transactions</span><br><b style="font-size:18px">${esc(mark)}</b> ${esc(MARK_TEXT[mark] || '')}</div>
    ${ov && (ov.dup || ov.differs) ? `<div class="card small notice"><b>Overlap</b><br>${ov.dup ? `${ov.dup} row${ov.dup === 1 ? '' : 's'} already counted from ${esc(ov.overlapWith.join(', '))}, so not counted again.` : ''}${ov.differs ? `<br>${ov.differs} row${ov.differs === 1 ? '' : 's'} inside the overlap did not match anything there and are kept.` : ''}</div>` : ''}
    ${c.notes.length ? `<div class="card small"><span class="muted">Reader notes</span><br>${c.notes.map(esc).join('<br>')}</div>` : ''}
    <div class="row"><button class="btn ghost" id="sc-close">Close</button><button class="btn" id="sc-acct">${c.acct ? 'Change account' : 'Name account'}</button></div></div>`);
  $('#sc-close').onclick = close;
  $('#sc-acct').onclick = async () => { await nameFiles([s.id], true); };
}

/** Ask which account these files belong to and save the answer straight away (used from the Statements screen). */
export async function nameFiles(ids, single) {
  const ss = ids.map(i => S.statements.find(x => x.id === i)).filter(Boolean); if (!ss.length) return;
  const book = JSON.parse(JSON.stringify(S.book));
  const r = S.files[ids[0]].result;
  const ans = await askAccount({ files: ss.map(s => ({ name: s.name, rows: s.count, period: s.period })), kind: r.accountType, why: r.accountTypeWhy, book }, { single });
  if (ans === null || ans === 'skip') { return openStatement(ids[0]); }
  const { accountId, created } = applyChoice(book, ans);
  ids.forEach(i => { book.assign[i] = accountId; });
  if (r.sig) book.layouts[r.sig] = accountId;
  if (created && created.kind === 'current' && !created.link) { S.accounts[created.id] = { role: created.role }; store.set('accounts', S.accounts); }
  S.book = book; await saveVault(); rebuild(); render(); toast('Saved');
}

function openReview(s) {
  const im = impactOf(s.id); const state = s.held ? 'out' : s.acked ? 'keep' : 'new';
  const title = `${esc(s.institution || s.type)} · ${esc(span(s.period))}`;
  show(`<div class="stack"><b style="font-size:17px">${title}</b>
    <div class="card small notice"><b>${state === 'out' ? 'Left out of your figures' : state === 'keep' ? 'Kept, and marked as checked by you' : "Read, but it doesn't add up"}</b><br>
      ${s.problems.length ? s.problems.map(esc).join('<br>') : 'A total on the statement does not match the transactions read.'}
      ${im && im.diff ? `<br>The transactions read are <b>${gbp(Math.abs(im.diff))}</b> ${im.diff > 0 ? 'short of' : 'over'} what the statement's own balances say.` : ''}</div>
    ${im ? `<div class="card small"><b>What it does to your figures</b><br>
      <b>If kept:</b> its ${im.n} transactions (${gbp(im.out)} out, ${gbp(im.into)} in${im.months.length ? ', ' + im.months.map(monthName).join(', ') : ''}) are counted in the dashboard and reports, and those months could be off${im.diff ? ' by about ' + gbp(Math.abs(im.diff)) : ''}.<br>
      <b>If left out:</b> those months show less spending and income. The statement stays on this list and you can put it back.</div>` : ''}
    <p class="small muted" style="margin:0">Best fix: add the CSV of the same statement. If it is checked, it replaces this one for those dates.</p>
    <div class="row" style="flex-wrap:wrap"><button class="btn ghost" id="rv-close">Close</button>
      ${state === 'out' ? '<button class="btn" id="rv-back">Put back in</button>' : '<button class="btn ghost" id="rv-out">Leave out</button>'}
      ${state === 'new' ? '<button class="btn" id="rv-keep">Keep, I checked it</button>' : state === 'keep' ? '<button class="btn ghost" id="rv-unkeep">Mark as unchecked</button>' : ''}</div></div>`);
  const set = async v => { const e = S.files[s.id]; if (v) e.hold = v; else delete e.hold; await saveVault(); rebuild(); render(); close(); toast(v === 'out' ? 'Left out of the figures' : v === 'keep' ? 'Kept' : 'Back to normal'); };
  $('#rv-close').onclick = close;
  if ($('#rv-out')) $('#rv-out').onclick = () => set('out');
  if ($('#rv-back')) $('#rv-back').onclick = () => set(null);
  if ($('#rv-keep')) $('#rv-keep').onclick = () => set('keep');
  if ($('#rv-unkeep')) $('#rv-unkeep').onclick = () => set(null);
}
