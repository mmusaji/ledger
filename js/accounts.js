/* Accounts: asking whether a newly found current account is Household or Personal, and changing it later. */
import { accountName, pendingAccounts, rebuild } from './model.js';
import { S } from './state.js';
import { render, toast } from './ui.js';
import { $, esc, store } from './util.js';

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
  }
  render();
}
