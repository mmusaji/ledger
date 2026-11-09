/* The naming sheet: "which account is this?" for CSV files that have no bank name in them, and the same choice later
 * when a file is moved to another account. Returns an answer for js/book.js applyChoice, 'skip', or null (cancel the import). */
import { accountName, accIdOf } from './model.js';
import { suggestPayHint } from './book.js';
import { S } from './state.js';
import { toast } from './ui.js';
import { $, esc, nice } from './util.js';

const span = p => !p ? '' : p.start === p.end ? nice(p.end) : nice(p.start) + ' – ' + nice(p.end);

/** Accounts already known from PDF statements, which a CSV can be said to belong to. */
export function pdfGroups() {
  const out = [];
  const seen = new Set();
  S.statements.filter(s => s.type === 'santander' || s.type === 'monzo').forEach(s => {
    const id = accIdOf(s); if (seen.has(id)) return; seen.add(id);
    const a = (S.accountList || []).find(x => x.id === id);
    const t = S.txns.find(x => x.accId === id);
    out.push({ gkey: id, accId: id, kind: 'current', txnType: s.type === 'monzo' ? 'monzo' : 'bank', label: t ? t.account : (a ? accountName(a) : 'Joint account'), name: (a ? accountName(a) : s.institution || id) });
  });
  [['amex', 'Amex'], ['tesco', 'Tesco credit card']].forEach(([type, name]) => {
    if (!S.statements.some(s => s.type === type)) return;
    const t = S.txns.find(x => x.stmtType === type);
    out.push({ gkey: type, kind: 'card', label: t ? t.account : name, name });
  });
  return out;
}

/** group: { files: [{name, rows, period}], kind: 'card'|'current'|'unknown', why, book } */
export function askAccount(group, opts = {}) {
  const book = group.book; const kind = group.kind;
  const linked = new Set(book.accounts.filter(a => a.link).map(a => a.link.gkey));
  const existing = book.accounts.filter(a => !a.link);
  const pdfs = pdfGroups().filter(g => !linked.has(g.gkey));
  const hasHousehold = (S.accountList || []).some(x => x.role === 'household') || Object.values(S.accounts || {}).some(c => c.role === 'household');
  const rows = group.files.reduce((s, f) => s + (f.rows || 0), 0);
  return new Promise(res => {
    S.sheetLocked = true;
    const same = a => kind === 'unknown' || a.kind === kind;
    const opt = (v, title, sub, checked) => `<label class="card small" style="display:block;cursor:pointer"><input type="radio" name="acct" value="${esc(v)}" ${checked ? 'checked' : ''}> <b>${esc(title)}</b>${sub ? `<br><span class="muted">${esc(sub)}</span>` : ''}</label>`;
    const options = [
      ...existing.filter(same).map(a => opt('e:' + a.id, a.name, `${a.kind === 'card' ? 'Card' : 'Current account'} you named earlier`, false)),
      ...pdfs.filter(same).map(g => opt('l:' + g.gkey, g.name, 'Same account as your PDF statements (the two are combined, so nothing is counted twice)', false)),
      opt('new', 'A new account', '', true)
    ].join('');
    $('#sheet-body').innerHTML = `<div class="stack">
      <b style="font-size:17px">Which account is this?</b>
      <div class="card small"><b>${group.files.length === 1 ? esc(group.files[0].name) : group.files.length + ' files with the same layout'}</b><br>
        <span class="muted">${group.files.length > 1 ? esc(group.files.map(f => f.name).join(', ')) + '<br>' : ''}${rows} transactions${group.files.length === 1 && group.files[0].period ? ' · ' + esc(span(group.files[0].period)) : ''}<br>
        ${kind === 'card' ? 'Looks like a <b>credit card</b>' : kind === 'current' ? 'Looks like a <b>current account</b>' : 'Could not tell if this is a card or a current account'}${group.why ? ' (' + esc(group.why) + ')' : ''}</span></div>
      <p class="small muted" style="margin:0">CSV files do not say which account they are from. Tell the app once and it will remember this layout for next time.</p>
      <div class="stack" id="acct-opts">${options}</div>
      <div class="stack" id="acct-new">
        <label class="field">Name<input id="an-name" placeholder="${kind === 'card' ? 'e.g. Amex · Fizza' : 'e.g. Monzo · Mustafa'}" autocomplete="off"></label>
        <div class="row" id="an-kind"><label><input type="radio" name="an-kind" value="card" ${kind === 'card' ? 'checked' : ''}> Credit card</label><label><input type="radio" name="an-kind" value="current" ${kind === 'current' ? 'checked' : ''}> Current account</label></div>
        <div id="an-role" hidden><div class="row"><label><input type="radio" name="an-role" value="household" checked> Household</label><label><input type="radio" name="an-role" value="personal" ${hasHousehold ? '' : 'disabled'}> Personal</label></div>
          <p class="small muted" style="margin:4px 0 0">${hasHousehold ? 'Household accounts are merged into one view. Personal ones are kept apart.' : 'The app needs one household account first, so this one will be the household account.'}</p></div>
        <label class="field" id="an-pay" hidden>Your bank statement shows payments to this card as<input id="an-hint" placeholder="e.g. AMERICAN EXP" autocomplete="off"></label>
        <p class="small muted" id="an-help" style="margin:0" hidden>Add " · Name" at the end to see spending by person, for example "Amex · Fizza".</p>
      </div>
      <div class="row"><button class="btn ghost" id="an-cancel">${opts.single ? 'Cancel' : 'Cancel import'}</button>${opts.single ? '' : '<button class="btn ghost" id="an-skip">Decide later</button>'}<button class="btn" id="an-ok">Save</button></div></div>`;
    const done = v => { S.sheetLocked = false; $('#sheet').close(); res(v); };
    const val = n => { const e = document.querySelector(`input[name=${n}]:checked`); return e ? e.value : ''; };
    const sync = () => {
      const isNew = val('acct') === 'new'; $('#acct-new').hidden = !isNew;
      const k = val('an-kind'); $('#an-role').hidden = k !== 'current'; $('#an-pay').hidden = k !== 'card'; $('#an-help').hidden = !isNew;
    };
    document.querySelectorAll('input[name=acct],input[name=an-kind]').forEach(i => i.addEventListener('change', sync));
    $('#an-name').addEventListener('input', () => { if ($('#an-hint') && !$('#an-hint').dataset.touched) $('#an-hint').value = suggestPayHint($('#an-name').value); });
    $('#an-hint').addEventListener('input', () => { $('#an-hint').dataset.touched = '1'; });
    sync();
    $('#an-cancel').onclick = () => done(null);
    if ($('#an-skip')) $('#an-skip').onclick = () => done('skip');
    $('#an-ok').onclick = () => {
      const v = val('acct');
      if (v.startsWith('e:')) return done({ mode: 'existing', accountId: v.slice(2) });
      if (v.startsWith('l:')) { const g = pdfs.find(x => x.gkey === v.slice(2)); return done({ mode: 'link', link: { gkey: g.gkey, accId: g.accId, label: g.label, txnType: g.txnType, kind: g.kind }, name: g.name }); }
      const name = $('#an-name').value.trim(); const k = val('an-kind');
      if (!name) { $('#an-name').focus(); return; }
      if (!k) return toast('Choose whether this is a credit card or a current account.');
      done({ mode: 'new', name, kind: k, role: val('an-role') || 'household', payHint: ($('#an-hint').value || '').trim() });
    };
    $('#sheet').showModal(); setTimeout(() => $('#an-name').focus(), 60);
  });
}
