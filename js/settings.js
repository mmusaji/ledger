/* Settings screen. */
import { CATEGORIES } from './deps.js';
import { accountName, rebuild, recategorise } from './model.js';
import { cycleLabel, cycleOf, payDay } from './period.js';
import { S } from './state.js';
import { applyTheme, toast } from './ui.js';
import { $, esc, niceShort, ordinal, store, today } from './util.js';

export function renderSettings() {
  const el = $('#view-settings');
  const D = payDay();
  const eg = cycleOf(today());
  el.innerHTML = `
    <h2>Pay month</h2>
    <div class="card stack">
      <p class="small muted" style="margin:0">Dashboard and reports group money into monthly pay cycles. Default is the <b>6th</b> (6th of one month to the 5th of the next). Only monthly cycles are supported.</p>
      <label class="field">Cycle starts on day
        <select id="pay-day">${Array.from({ length: 28 }, (_, i) => i + 1).map(d => `<option value="${d}" ${d === D ? 'selected' : ''}>${ordinal(d)}</option>`).join('')}</select>
      </label>
      <div class="small muted">Current cycle example: <b>${niceShort(eg.start)} – ${niceShort(eg.end)}</b> (${cycleLabel(eg.key)}). Changing this re-groups existing transactions; it does not re-read PDFs. Bank statements run 6th to 5th, so if your pay month starts on another day, the first and last pay month are only part covered. The dashboard leaves those out and says so, until the rest of the statements are added.</div>
    </div>

    ${S.accountList.length ? `<h2>Accounts</h2>
    <div class="card stack">
      <p class="small muted" style="margin:0">Household accounts are merged into one household view. A personal account is kept apart and shown when you pick it at the top of the Dashboard and Reports. You need at least one household account. Changing this regroups what is already saved; nothing is read again.</p>
      <ul class="list">${S.accountList.map(a => `<li><div class="who"><b>${esc(accountName(a))}</b><span>${a.role ? (a.role === 'household' ? 'Household' : 'Personal') : 'Waiting for you to choose'}</span></div>
        <div class="seg">${['household', 'personal'].map(r => `<button class="${a.role === r ? 'on' : ''}" data-act="acc-role" data-v="${esc(a.id)}|${r}">${r === 'household' ? 'Household' : 'Personal'}</button>`).join('')}</div></li>${a.role === 'personal' ? `<li><span class="small muted">Find payments from the household account to this one and count them as personal spending.</span><button class="btn ghost slim" data-act="acc-find" data-v="${esc(a.id)}">Find transfers</button></li>` : ''}`).join('')}</ul>
    </div>` : ''}

    <h2>PDFs from other banks</h2>
    <div class="card stack">
      <p class="small muted" style="margin:0">Statements from banks the app has no reader for can still be read when every figure can be proven (a running balance or the printed totals). Anything it cannot prove is refused. These are shown as "other bank, checked" and you name the account, as with a CSV.</p>
      <div class="row"><span>${store.get('smartPdf', true) ? 'On' : 'Off'}</span><button class="btn ghost slim" data-act="toggle-smart">${store.get('smartPdf', true) ? 'Turn off' : 'Turn on'}</button></div>
    </div>

    <h2>Your categorisation rules (${S.rules.length})</h2>
    <div class="card stack">
      <p class="small muted" style="margin:0">If a transaction's description contains the text, it gets that category. Your rules run before the built-in ones. Tip: tap any transaction to fix its category, and a rule is added for you.</p>
      <div class="grid2"><label class="field">Text contains<input id="r-text" placeholder="e.g. DELIVEROO"></label>
        <label class="field">Category<select id="r-cat">${CATEGORIES.map(x => `<option>${esc(x.name)}</option>`).join('')}</select></label></div>
      <div class="row"><div class="seg" id="r-dir"><button data-v="" class="on">Either</button><button data-v="out">Out</button><button data-v="in">In</button></div><button class="btn" data-act="add-rule">Add rule</button></div>
      <ul class="list">${S.rules.map((r, i) => `<li><div class="who"><b>${esc(r.text)}</b><span>→ ${esc(r.category)}${r.dir ? ' · money ' + r.dir : ''}</span></div><button class="btn danger slim" data-act="del-rule" data-v="${i}">Delete</button></li>`).join('')}</ul>
      <details><summary class="small" style="cursor:pointer">Import or copy rules</summary>
        <div class="stack" style="margin-top:10px">
          <input type="file" id="r-file" accept=".json,application/json" class="input">
          <textarea id="r-json" class="input" rows="4" placeholder='Or paste: [{"text":"...","category":"Groceries","dir":"out"}]'></textarea>
          <div class="row"><button class="btn ghost" data-act="copy-rules">Copy my rules</button><button class="btn" data-act="import-rules">Import</button></div>
        </div></details>
    </div>

    <h2>Saved reports (${S.presets.length})</h2>
    <div class="card">${S.presets.length ? `<ul class="list">${S.presets.map((p, i) => `<li><div class="who"><b>${esc(p.name)}</b></div><button class="btn danger slim" data-act="del-preset" data-v="${i}">Delete</button></li>`).join('')}</ul>` : '<span class="muted small">Save one from the Reports screen.</span>'}</div>

    <h2>Appearance</h2>
    <div class="card"><div class="seg" id="theme">${['auto', 'light', 'dark'].map(t => `<button data-v="${t}" class="${(store.get('theme', 'auto')) === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>

    <h2>Saved data</h2>
    <div class="card stack small">
      ${!S.meta ? '<div class="muted">Nothing saved yet. Your first statements are saved here, encrypted.</div>' : `
      <div><b>${S.statements.length} statement${S.statements.length === 1 ? '' : 's'} saved</b>, encrypted on this phone${S.meta.mode === 'pin' ? ' and locked with a passcode. It locks itself after 5 minutes in the background.' : ' without a passcode. Anyone who can open this app on your phone can see them.'}</div>
      <div class="row" style="flex-wrap:wrap">${S.meta.mode === 'pin'
        ? '<button class="btn ghost" data-act="lock">Lock now</button><button class="btn ghost" data-act="change-pin">Change passcode</button><button class="btn danger" data-act="remove-pin">Remove passcode</button>'
        : '<button class="btn" data-act="change-pin">Set a passcode</button>'}</div>
      <div class="row"><span class="muted">Erase saved statements. Your settings and rules stay, and you add the statements again.</span><button class="btn danger" data-act="erase-data">Erase</button></div>`}
    </div>

    <h2>Privacy</h2>
    <div class="card stack small">
      <div>• Statement PDFs and CSVs are read in this phone's memory, then discarded. The files themselves are never saved or uploaded.</div>
      <div>• What's read from them is saved on this phone with AES-256 encryption, so the app opens straight away and only new statements are read.</div>
      <div>• No server, no analytics, no AI. After it loads, the app doesn't contact anyone.</div>
      <div>• Also saved on this phone: the settings above, your rules, saved reports, and category corrections (stored as one-way hashes).</div>
      <div class="row"><span></span><button class="btn danger" data-act="forget">Forget everything</button></div>
    </div>
    <p class="muted small" style="text-align:center">Household Ledger v4.0 · household and personal accounts, cards, payslips, ISA and pension</p>`;
  let dir = '';
  $('#r-dir').addEventListener('click', e => { if (e.target.dataset.v === undefined) return; dir = e.target.dataset.v; [...$('#r-dir').children].forEach(b => b.classList.toggle('on', b === e.target)); });
  $('[data-act="add-rule"]').addEventListener('click', () => {
    const text = $('#r-text').value.trim(); if (!text) return toast('Enter some text to match.');
    S.rules.unshift({ text, category: $('#r-cat').value, dir: dir || undefined }); store.set('rules', S.rules); recategorise(); renderSettings(); toast('Rule added');
  });
  $('#r-file').addEventListener('change', async e => { const f = e.target.files[0]; if (f) $('#r-json').value = await f.text(); });
  $('#theme').addEventListener('click', e => { const v = e.target.dataset.v; if (!v) return; store.set('theme', v); applyTheme(); renderSettings(); });
  $('#pay-day').addEventListener('change', e => {
    const d = +e.target.value;
    if (!(d >= 1 && d <= 28)) return;
    store.set('payDay', d);
    rebuild();
    renderSettings();
    toast(`Pay month now starts on the ${ordinal(d)}`);
  });
}
