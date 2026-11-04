/* Accounts: asking whether a newly found current account is Household or Personal, and changing it later. */
import { accountName, inHousehold, isCurrent, pendingAccounts, rebuild, recategorise } from './model.js';
import { S } from './state.js';
import { render, toast } from './ui.js';
import { $, daysBetween, esc, gbp, store } from './util.js';

export function setRole(id, role) {
  S.accounts[id] = Object.assign({}, S.accounts[id], { role });
  if (!S.demo) store.set('accounts', S.accounts);
  if (role === 'personal' && S.scope === 'household') { /* stays on Household until you pick the account */ }
  rebuild();
}

/** One question per new account. The first account must be the household's; later ones can be either. */
export async function checkNewAccounts() {
  if (S.locked || S.loading) return;
  for (let guard = 0; guard < 8; guard++) {
    const a = pendingAccounts()[0]; if (!a) break;
    const hasHousehold = S.accountList.some(x => x.role === 'household');
    const role = await new Promise(res => {
      S.sheetLocked = true;
      $('#sheet-body').innerHTML = `<div class="stack">
        <b style="font-size:17px">New account found: ${esc(accountName(a))}</b>
        <p class="small muted" style="margin:0">Is this one of the household's main accounts, or a personal account?</p>
        <div class="card small"><b>Household</b><br>Joint or shared. Merged with your other household accounts into one household view: income, spending, balance, everything.</div>
        <div class="card small"><b>Personal</b><br>Kept apart from the household figures. You switch to it at the top of the Dashboard and Reports. Money moved between it and the household account shows there.</div>
        ${hasHousehold ? '' : '<p class="small muted" style="margin:0">The app needs one household account first, so this one will be the household account.</p>'}
        <div class="row"><button class="btn" id="role-h">Household</button><button class="btn ghost" id="role-p" ${hasHousehold ? '' : 'disabled'}>Personal</button></div></div>`;
      const done = v => { S.sheetLocked = false; $('#sheet').close(); res(v); };
      $('#role-h').onclick = () => done('household'); $('#role-p').onclick = () => done('personal');
      $('#sheet').showModal();
    });
    setRole(a.id, role);
    toast(`${accountName(a)} added as ${role === 'household' ? 'a household' : 'a personal'} account.`);
    if (role === 'personal') await offerTransferRules(a.id);
  }
  render();
}

const OUT_CATEGORY = 'Personal', IN_CATEGORY = 'Family contribution';

/** The words of a household-account line that identify who the money went to or came from. */
const ruleTextOf = d => { const s = d.replace(/\s+-?[\d,]*\d\.\d{2}\b.*$/, '').split(',')[0]; const m = s.match(/\b(TO|FROM)\s.+$/i); return (m ? m[0] : s).replace(/\s+/g, ' ').trim(); };

/** Household-account payments that match, by amount and date, the account holder's own payments in this personal account,
 *  grouped into rules: money to the personal account is Personal spending, money back from it is a Family contribution. */
export function transferSuggestions(accId) {
  const hh = S.txns.filter(t => isCurrent(t) && inHousehold(t) && !t.pot);
  const pers = S.txns.filter(t => t.accId === accId && t.self && !t.pot);
  const taken = new Set(), groups = new Map();
  pers.forEach(p => {
    let best = null;
    hh.forEach(h => { if (taken.has(h) || h.amount !== -p.amount) return; const d = Math.abs(daysBetween(h.date, p.date)); if (d <= 3 && (!best || d < best.d)) best = { h, d }; });
    if (!best) return;
    taken.add(best.h);
    const dir = best.h.amount < 0 ? 'out' : 'in', text = ruleTextOf(best.h.desc), k = dir + '|' + text;
    const g = groups.get(k) || { text, dir, category: dir === 'out' ? OUT_CATEGORY : IN_CATEGORY, n: 0, total: 0 };
    g.n++; g.total += best.h.amount; groups.set(k, g);
  });
  // leave out anything your own rules already file under that category
  return [...groups.values()].filter(g => !S.rules.some(r => r.text.toLowerCase() === g.text.toLowerCase() && (r.dir || '') === g.dir && r.category === g.category));
}

export function applyTransferRules(list) {
  list.forEach(g => {
    S.rules = S.rules.filter(r => !(r.text.toLowerCase() === g.text.toLowerCase() && (r.dir || '') === g.dir));
    S.rules.unshift({ text: g.text, category: g.category, dir: g.dir });
  });
  store.set('rules', S.rules); recategorise();
}

/** Offer the rules found for a personal account. Nothing changes unless you accept. */
export async function offerTransferRules(accId) {
  const list = transferSuggestions(accId); if (!list.length) return;
  const a = S.accountList.find(x => x.id === accId);
  const yes = await new Promise(res => {
    S.sheetLocked = true;
    $('#sheet-body').innerHTML = `<div class="stack">
      <b style="font-size:17px">Count transfers to ${esc(a ? accountName(a) : 'this account')} as personal spending?</b>
      <p class="small muted" style="margin:0">These household-account payments match money that arrived in this account, so they are the household paying you, not an unknown payment. Accepting saves a rule for each. Money that moves back counts as income. You can change or delete the rules in Settings.</p>
      <ul class="list">${list.map(g => `<li><div class="who"><b>${esc(g.text)}</b><span>${g.n} payment${g.n === 1 ? '' : 's'} · ${gbp(g.total)} → ${esc(g.category)}</span></div></li>`).join('')}</ul>
      <div class="row"><button class="btn ghost" id="tr-no">Not now</button><button class="btn" id="tr-yes">Save ${list.length} rule${list.length === 1 ? '' : 's'}</button></div></div>`;
    const done = v => { S.sheetLocked = false; $('#sheet').close(); res(v); };
    $('#tr-yes').onclick = () => done(true); $('#tr-no').onclick = () => done(false);
    $('#sheet').showModal();
  });
  if (yes) { applyTransferRules(list); toast(`${list.length} rule${list.length === 1 ? '' : 's'} saved`); }
}
