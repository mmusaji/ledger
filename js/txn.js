/* The transaction detail sheet (change a category). */
import { CATEGORIES } from './deps.js';
import { recategorise } from './model.js';
import { S } from './state.js';
import { render, toast } from './ui.js';
import { $, esc, gbp, nice, store } from './util.js';

export function openTxn(key) {
  const t = S.txns.find(x => x.key === key); if (!t) return;
  const body = $('#sheet-body');
  const repay = t.repayStatus === 'matched' ? `Paid off the card statement “${esc(t.match)}”, so it isn't counted as spending.` :
    t.repayStatus === 'covered' ? 'Card statements for this period are loaded, so this repayment is not counted as spending.' :
    t.repayStatus === 'nocard' ? 'No card statement found for this repayment, so it is counted as spending.' : '';
  body.innerHTML = `<div class="stack">
    <div class="row"><b style="font-size:17px">${esc(t.payee)}</b><b class="num ${t.amount < 0 ? 'out' : 'in'}">${gbp(t.amount, true)}</b></div>
    <div class="muted small">${nice(t.date)} · ${esc(t.kind)} · ${esc(t.account)}${t.balance !== null ? ' · balance after ' + gbp(t.balance) : ''}${t.foreign ? ` · ${esc(t.foreign)} ${esc((t.currency || '').toLowerCase())}` : ''}</div>
    <div class="desc">${esc(t.desc)}${t.detail ? '<br>' + esc(t.detail) : ''}</div>
    ${repay ? `<div class="small muted">${repay}</div>` : ''}
    <label class="field">Category<select id="s-cat">${CATEGORIES.map(c => `<option ${c.name === t.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label class="small" style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" id="s-all" checked style="margin-top:3px">
      <span>Use this category for every ${t.amount < 0 ? 'payment to' : 'payment from'} <b>${esc(t.payee)}</b> (saves a rule on this phone)</span></label>
    <div class="muted small">Currently set by: ${esc(t.catBy)}${t.catRule ? ` (“${esc(t.catRule)}”)` : ''} · from ${esc(t.source)}</div>
    <div class="row"><button class="btn ghost" data-act="sheet-close">Close</button><button class="btn" data-act="sheet-save" data-v="${t.key}">Save</button></div>
  </div>`;
  $('#sheet').showModal();
}

export function saveTxn(key) {
  const t = S.txns.find(x => x.key === key); const cat = $('#s-cat').value;
  if ($('#s-all').checked) {
    const text = t.type === 'card' ? t.desc.split(/\s{1,}\d{3,}|\*/)[0].trim().slice(0, 30) || t.payee : t.payee;
    S.rules = S.rules.filter(r => !(r.text.toLowerCase() === text.toLowerCase() && r.dir === (t.amount < 0 ? 'out' : 'in')));
    S.rules.unshift({ text, category: cat, dir: t.amount < 0 ? 'out' : 'in' });
    store.set('rules', S.rules);
  } else { S.overrides[key] = cat; store.set('overrides', S.overrides); }
  recategorise(); $('#sheet').close(); render(); toast('Saved');
}
