/* Household Ledger v2 — reads the statement PDFs you choose with your phone's own file chooser
 * (or send with Share), entirely on this phone. Nothing is sent anywhere.
 * Statement PDFs are read in memory and never saved. What is read from them is saved on this
 * phone in IndexedDB, encrypted with AES-GCM (key from your passcode via PBKDF2), so the app
 * opens instantly and only statements that are new are read.
 * Also saved on this phone: files you removed from the app, your rules,
 * category corrections (stored as hashes) and saved report filters.
 */
(function () {
  'use strict';
  const { CATEGORIES, GROUP_OF, categorise } = window.FinRules;
  const P = window.FinParser, RD = window.FinReaders;
  if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  // ---------- helpers ----------
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const gbp = (p, sign) => {
    const s = '£' + (Math.abs(p) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (sign && p > 0) return '+' + s;
    return p < 0 ? '−' + s : s;
  };
  const gbp0 = p => (p < 0 ? '−' : '') + '£' + Math.round(Math.abs(p) / 100).toLocaleString('en-GB');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const nice = iso => { const [y, m, d] = iso.split('-'); return `${+d} ${MON[+m - 1]} ${y}`; };
  const niceShort = iso => { const [, m, d] = iso.split('-'); return `${+d} ${MON[+m - 1]}`; };
  const monthKey = iso => iso.slice(0, 7);
  const monthLabel = k => { const [y, m] = k.split('-'); return `${MON[+m - 1]} ${y}`; };
  const ordinal = n => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
  const pad = n => String(n).padStart(2, '0');
  const isoOf = d => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); };
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
  const today = () => isoOf(new Date());
  const sum = (arr, f = t => t.amount) => arr.reduce((s, t) => s + f(t), 0);
  const personOf = acc => (acc && acc.includes(' · ')) ? acc.split(' · ')[1] : 'Joint account';
  const ONE_OFF = 50000; // £500

  // Pay cycle: the 6th of one month to the 5th of the next (salary lands around the 25th).
  function cycleOf(iso) {
    let y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
    if (d < 6) { m -= 1; if (m === 0) { m = 12; y -= 1; } }
    const start = `${y}-${pad(m)}-06`;
    const e = new Date(Date.UTC(y, m, 5));
    return { key: `${y}-${pad(m)}`, start, end: isoOf(e) };
  }
  const cycleLabel = key => monthLabel(key);
  const cycleShort = key => MON[+key.slice(5) - 1];

  const store = {
    get(k, d) { try { const v = localStorage.getItem('ledger.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('ledger.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    clear() { try { Object.keys(localStorage).filter(k => k.startsWith('ledger.')).forEach(k => localStorage.removeItem(k)); } catch { } }
  };
  // FNV-1a: corrections are stored against a hash, so no amounts or descriptions are written in clear.
  function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }
  const baseKey = t => hash(`${t.date}|${t.amount}|${t.balance ?? ''}|${t.desc}|${t.account || ''}`);
  const keyOf = t => t.key;

  // ---------- state ----------
  const S = {
    rules: store.get('rules', []),
    overrides: store.get('overrides', {}),
    presets: store.get('presets', []),
    hideOneOffs: store.get('hideOneOffs', false),
    statements: [], skipped: [], txns: [], payslips: [], isa: [], pension: [],
    ignored: store.get('ignored', []), // files you removed from the app (left out even if you select the whole folder again)
    files: {}, lastSync: null, key: null, meta: null, locked: false, hiddenAt: 0, sheetLocked: false,
    demo: false, loading: false, progress: 0,
    view: 'home', period: 'latest', payIdx: null,
    filter: null, showN: 100
  };
  const blankFilter = () => ({ q: '', match: 'any', from: '', to: '', dir: 'out', cats: [], kinds: [], accounts: [], min: '', max: '' });
  S.filter = blankFilter();

  // ---------- building the picture from saved statements ----------
  const MONEY_TYPES = ['santander', 'amex', 'tesco'];
  function rebuild(extraSkipped = []) {
    const entries = Object.entries(S.files).map(([id, e]) => Object.assign({ id }, e));
    const read = [], skipped = [];
    entries.forEach(e => {
      const r = e.result;
      if (r && r.period && r.type && r.type !== 'unsupported' && r.type !== 'unreadable') read.push(e);
      else skipped.push({ id: e.id, name: e.name, why: e.skipped || (r && r.problems && r.problems[0]) || 'Not read', type: r && r.type });
    });
    // The same statement saved twice (e.g. "tescobank (3).pdf" and "(4)") is only counted once.
    read.sort((a, b) => (b.result.ok - a.result.ok) || a.name.localeCompare(b.name));
    const seen = new Map(), kept = [];
    read.forEach(e => {
      const r = e.result; const k = [r.type, (r.holders || []).join(','), r.period.start, r.period.end].join('|');
      if (seen.has(k)) skipped.push({ id: e.id, name: e.name, why: 'Duplicate of ' + seen.get(k), dup: true });
      else { seen.set(k, e.name); kept.push(e); }
    });
    S.statements = kept.map(e => {
      const r = e.result;
      return { id: e.id, name: e.name, type: r.type, institution: r.institution, period: r.period, ok: r.ok, problems: r.problems || [],
        count: (r.txns || []).length, opening: r.opening, closing: r.closing, summary: r.summary, holders: r.holders };
    }).sort((a, b) => a.period.end.localeCompare(b.period.end));
    const txns = [];
    kept.filter(e => MONEY_TYPES.includes(e.result.type)).forEach(e => {
      const n = {};
      (e.result.txns || []).forEach(t0 => {
        const t = Object.assign({}, t0, { source: e.name, stmtType: e.result.type });
        if (t.balance === undefined) t.balance = null;
        if (!t.account) t.account = 'Joint account';
        if (!t.type) t.type = e.result.type === 'santander' ? 'bank' : 'card';
        if (!t.payee) t.payee = t.desc.slice(0, 30);
        const b = baseKey(t); n[b] = (n[b] || 0) + 1; t.key = n[b] > 1 ? b + '.' + n[b] : b;
        t.cycle = cycleOf(t.date).key;
        txns.push(t);
      });
    });
    txns.sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'bank' && b.type === 'bank' ? 0 : 0));
    S.txns = txns;
    S.payslips = kept.filter(e => e.result.type === 'payslip').map(e => Object.assign({ name: e.name }, e.result)).sort((a, b) => a.payDate.localeCompare(b.payDate));
    S.isa = kept.filter(e => e.result.type === 'moneyfarm').map(e => Object.assign({ name: e.name }, e.result)).sort((a, b) => a.period.end.localeCompare(b.period.end));
    S.pension = kept.filter(e => e.result.type === 'aviva').map(e => Object.assign({ name: e.name }, e.result)).sort((a, b) => a.period.end.localeCompare(b.period.end));
    S.skipped = skipped.concat(extraSkipped);
    recategorise();
  }

  /** Categorise everything and stop card repayments being counted twice. */
  function recategorise() {
    const cardStmts = S.statements.filter(s => s.type === 'amex' || s.type === 'tesco');
    S.txns.forEach(t => {
      t.match = null; t.repayStatus = null;
      if (t.kind === 'Card repayment received') { t.category = 'Card repayment (card side)'; t.group = 'internal'; t.catBy = 'card statement'; return; }
      const c = categorise(t, S.rules, S.overrides, keyOf);
      t.category = c.category; t.group = GROUP_OF[c.category]; t.catBy = c.by; t.catRule = c.rule;
      if (t.group === 'cards' && t.type === 'bank' && t.amount < 0) {
        const inst = /AMERICAN EXP|AMEX/i.test(t.desc) ? 'amex' : /TESCO BANK/i.test(t.desc) ? 'tesco' : null;
        const pool = cardStmts.filter(s => s.type === inst);
        const m = pool.find(s => s.summary && (s.summary.closing === -t.amount) && t.date >= s.period.end && daysBetween(s.period.end, t.date) <= 40);
        const covered = pool.some(s => s.period.end <= t.date && daysBetween(s.period.end, t.date) <= 40); // the statement it pays off is loaded
        if (m) { t.match = m.name; t.repayStatus = 'matched'; t.group = 'paidcard'; }
        else if (covered) { t.repayStatus = 'covered'; t.group = 'paidcard'; }
        else t.repayStatus = 'nocard';
      }
    });
  }
  const isSpend = t => t.group === 'spend' || t.group === 'cards';
  const oneOff = t => isSpend(t) && -t.amount >= ONE_OFF;

  function cycles() { return [...new Set(S.txns.filter(t => t.type === 'bank').map(t => t.cycle))].sort(); }
  function rangeFor(p) {
    const cs = cycles(); if (!cs.length) return null;
    const lastKey = cs[cs.length - 1]; const last = cycleOf(lastKey + '-06');
    if (p === 'latest') return { from: last.start, to: last.end, keys: [lastKey], label: `Pay month ${cycleLabel(lastKey)} · ${niceShort(last.start)} – ${niceShort(last.end)}` };
    if (p === 'all') return { from: cycleOf(cs[0] + '-06').start, to: last.end, keys: cs, label: `All ${cs.length} pay months` };
    if (p === 'tax') {
      const y = +last.end.slice(0, 4); const sy = last.end.slice(5) >= '04-06' ? y : y - 1;
      const keys = cs.filter(k => cycleOf(k + '-06').start >= `${sy}-04-06`);
      return { from: `${sy}-04-06`, to: last.end, keys, label: `Tax year ${sy}/${String(sy + 1).slice(2)} so far` };
    }
    const keys = cs.slice(-(+p));
    return { from: cycleOf(keys[0] + '-06').start, to: last.end, keys, label: `Last ${keys.length} pay month${keys.length > 1 ? 's' : ''} · ${cycleLabel(keys[0])} – ${cycleLabel(lastKey)}` };
  }
  const inRange = (t, r) => t.date >= r.from && t.date <= r.to;

  // ---------- saved data: encrypted on this phone (IndexedDB) ----------
  const PARSER_VERSION = 2; // bump when a reader changes, so old statements are read again
  const enc = new TextEncoder(), dec = new TextDecoder();
  const idb = {
    db: null,
    async open() {
      if (!this.db) this.db = await new Promise((res, rej) => {
        const r = indexedDB.open('ledger', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      return this.db;
    },
    async op(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => { const tx = db.transaction('kv', mode); const r = fn(tx.objectStore('kv')); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); });
    },
    get(k) { return this.op('readonly', st => st.get(k)); },
    put(k, v) { return this.op('readwrite', st => st.put(v, k)); },
    clear() { return this.op('readwrite', st => st.clear()); }
  };
  async function keyFromPin(pin, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function saveVault() {
    if (!S.key || S.demo) return;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, S.key, enc.encode(JSON.stringify({ files: S.files, lastSync: S.lastSync })));
    await idb.put('vault', { iv, ct, saved: Date.now() });
  }
  async function openVault(key) {
    const v = await idb.get('vault');
    if (v) {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: v.iv }, key, v.ct); // fails if the passcode is wrong
      const j = JSON.parse(dec.decode(pt));
      S.files = j.files || {}; S.lastSync = j.lastSync || null;
    }
    S.key = key; S.locked = false; S.demo = false;
    rebuild();
  }
  async function setPin(pin) {
    if (pin) { const salt = crypto.getRandomValues(new Uint8Array(16)); S.key = await keyFromPin(pin, salt); S.meta = { mode: 'pin', salt }; }
    else { S.key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); S.meta = { mode: 'device', key: S.key }; }
    await idb.put('meta', S.meta); await saveVault();
  }
  function askNewPin(change) {
    return new Promise(res => {
      S.sheetLocked = true;
      $('#sheet-body').innerHTML = `<div class="stack">
        <b style="font-size:17px">${change ? 'Choose a new passcode' : 'Lock your saved statements'}</b>
        <p class="muted small" style="margin:0">What's read from your statements is saved on this phone, encrypted, so the app opens straight away and only reads new statements. With a passcode, nobody can open it without the code, not even someone using your unlocked phone. If you forget it, erase the saved data and sync again.</p>
        <label class="field">Passcode (at least 4 characters)<input id="p1" type="password" inputmode="numeric" autocomplete="new-password"></label>
        <label class="field">Type it again<input id="p2" type="password" inputmode="numeric" autocomplete="new-password"></label>
        <div class="row"><button class="btn ghost" id="p-skip">${change ? 'Cancel' : 'No passcode'}</button><button class="btn" id="p-ok">Set passcode</button></div></div>`;
      const done = v => { S.sheetLocked = false; $('#sheet').close(); res(v); };
      $('#p-ok').onclick = () => { const a = $('#p1').value, b = $('#p2').value; if (a.length < 4) return toast('Use at least 4 characters.'); if (a !== b) return toast('The two passcodes do not match.'); done(a); };
      $('#p-skip').onclick = () => done(change ? undefined : null);
      $('#sheet').showModal(); setTimeout(() => $('#p1').focus(), 60);
    });
  }
  async function ensureKey() { if (!S.key) await setPin(await askNewPin(false)); }
  function lock() {
    if (!S.meta || S.meta.mode !== 'pin') return;
    S.key = null; S.files = {}; S.txns = []; S.statements = []; S.skipped = []; S.payslips = []; S.isa = []; S.pension = []; S.locked = true;
    if ($('#sheet').open) { S.sheetLocked = false; $('#sheet').close(); }
    statusLine(); go('home');
  }
  function statusLine() {
    if (S.demo) return status('Sample data (invented)');
    if (S.locked) return status('Locked');
    if (!S.statements.length) return status('');
    const d = S.lastSync ? new Date(S.lastSync).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never';
    status(`updated ${d}`);
  }

  /** Read PDFs chosen with the phone's own file chooser (any folder, or Google Drive, with "Select all").
   *  Each file is identified by a fingerprint of its contents, so choosing a whole folder again
   *  only reads the statements that are new. Nothing is uploaded anywhere. */
  async function addLocalFiles(list) {
    const fileList = [...list].filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!fileList.length) return toast('No PDFs chosen.');
    if (S.demo && S.meta) return toast('This is the sample-data demo, so your own statements are not touched. Open the app without ?demo to add statements.');
    if (S.loading) return;
    S.loading = true; S.progress = 0; render();
    let added = 0, known = 0, skippedIgnored = 0; const notes = [];
    try {
      await ensureKey();
      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        status(`Reading ${i + 1}/${fileList.length}`); S.progress = (i + 1) / fileList.length;
        const bar = $('#progress div'); if (bar) bar.style.width = (S.progress * 100) + '%';
        try {
          let bytes = await f.arrayBuffer();
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
          const id = 'local:' + [...digest.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
          if (S.ignored.includes(id)) { skippedIgnored++; continue; }
          if (S.files[id] && S.files[id].v === PARSER_VERSION) { known++; continue; }
          const entry = { name: f.name, md5: '', modified: '', v: PARSER_VERSION, src: 'local' };
          const pages = await P.extractPages(window.pdfjsLib, bytes);
          bytes = null; // the PDF itself is dropped as soon as it has been read
          const r = RD.readStatement(pages, f.name);
          if (r.period && r.type !== 'unsupported' && r.type !== 'unreadable') entry.result = r;
          else entry.skipped = (r.problems || [])[0] || 'Not a statement this app reads';
          S.files[id] = entry; added++;
          if (added % 5 === 0) await saveVault();
        } catch (e) { notes.push({ name: f.name, why: 'Could not read: ' + e.message }); }
      }
      S.lastSync = new Date().toISOString(); S.demo = false;
      await saveVault(); rebuild(notes);
      toast(`${added} new file${added === 1 ? '' : 's'} read` + (known ? `, ${known} already in the app` : '') + (skippedIgnored ? `, ${skippedIgnored} removed earlier and left out` : ''));
    } catch (e) { toast(e.message); }
    finally { S.loading = false; statusLine(); render(); }
  }

  /** Files sent with the phone's Share menu (for example from the Google Drive app) are parked briefly by the
   *  service worker, read here, then deleted straight away. */
  async function checkInbox() {
    if (S.locked || S.loading || !('caches' in window)) return;
    let c; try { c = await caches.open('ledger-inbox'); } catch { return; }
    const keys = await c.keys(); if (!keys.length) return;
    const files = [];
    for (const k of keys) {
      const r = await c.match(k); if (!r) continue;
      const name = decodeURIComponent(r.headers.get('x-name') || 'shared.pdf');
      files.push(new File([await r.blob()], name, { type: 'application/pdf' }));
    }
    try { await addLocalFiles(files); }
    finally { for (const k of await c.keys()) await c.delete(k); }
  }
  function chooseLocalFiles() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true; inp.accept = 'application/pdf,.pdf';
    inp.onchange = () => addLocalFiles(inp.files);
    inp.click();
  }

  // ---------- sample data (invented) so the app can be explored before setup ----------
  function loadDemo() {
    const rnd = (a, b) => Math.round(a + Math.random() * (b - a));
    const files = {}; let bal = 180000; let id = 0;
    const add = r => { files['demo' + (id++)] = { name: r.name, result: r }; };
    const base = new Date(); base.setUTCDate(5); base.setUTCMonth(base.getUTCMonth() - 1);
    for (let k = 5; k >= 0; k--) {
      const e = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - k, 5));
      const s = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() - 1, 6));
      const d = n => isoOf(new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 6 + n)));
      const amexClose = rnd(200000, 380000), tescoClose = rnd(150000, 260000);
      const rows = [
        [2, 'TRANSFER FROM SAMPLE PERSONAL ACCOUNT', 50000], [4, 'DIRECT DEBIT PAYMENT TO VIRGIN MEDIA PYMTS REF 1, MANDATE NO 0031', -3900],
        [4, 'DIRECT DEBIT PAYMENT TO O2 REF D1, MANDATE NO 0051', -1500], [6, 'Third party payment made via Faster Payment to SAMPLE CLEANING Reference 1', -5700],
        [13, 'DIRECT DEBIT PAYMENT TO SCOTTISHPOWER REF 1, MANDATE NO 0043', -2950], [rnd(1, 20), 'CASH WITHDRAWAL AT SAMPLE ATM, SAMPLETOWN,100.00 GBP , ON 08-08-2026', -rnd(5, 15) * 1000],
        [19, 'BANK GIRO CREDIT REF ACME UK LTD, SALARY', 760000], [20, 'Third party payment made via Faster Payment to TESCO BANK Reference 1', -tescoClose],
        [20, 'Third party payment made via Faster Payment to AMERICAN EXP 3773 Reference PB1', -amexClose], [22, 'DIRECT DEBIT PAYMENT TO L&G INSURANCE MI REF 1, MANDATE NO 0062', -4246],
        [25, 'REGULAR TRANSFER PAYMENT TO ACCOUNT SAVING R1, MANDATE NO 140', -20000], [25, 'DIRECT DEBIT PAYMENT TO EDF ENERGY REF A-1, MANDATE NO 0053', -rnd(15000, 37000)],
        [25, 'DIRECT DEBIT PAYMENT TO SANTANDER MORTGAGE REF 1, MANDATE NO 0035', -147055], [25, 'DIRECT DEBIT PAYMENT TO SEVERN TRENT WATER REF 1, MANDATE NO 0033', -7615],
        [25, 'DIRECT DEBIT PAYMENT TO SAMPLE BOROUGH COUNCIL REF 1, MANDATE NO 0036', -29600], [25, 'TRANSFER FROM SAMPLE PERSONAL ACCOUNT', 150000],
        [27, 'FASTER PAYMENTS RECEIPT REF.Contribution FROM Sample Relative', rnd(0, 1) ? 200000 : 0], [29, 'MAINTAINING THE ACCOUNT - MONTHLY FEE', -300]
      ].filter(r => r[2] !== 0).sort((a, b) => a[0] - b[0]);
      const opening = bal;
      const btx = rows.map(([n, desc, amount]) => { bal += amount; return { date: d(n), desc, amount, balance: bal, kind: P.kindOf(desc), payee: P.payeeOf(desc), account: 'Joint account', holder: 'Joint', type: 'bank' }; });
      add({ type: 'santander', institution: 'Santander', name: `Sample bank ${MON[e.getUTCMonth()]}`, period: { start: isoOf(s), end: isoOf(e) }, opening, closing: bal, txns: btx, ok: true, problems: [] });
      const merch = [['CO-OP - GROBY SAMPLETOWN', 'Person B', 900, 4500], ['TESCO STORE 1234 SAMPLETOWN', 'Person B', 2000, 9000], ['DELIVEROO LONDON', 'Person A', 1800, 4500], ['AMAZON.CO.UK*ABC', 'Person B', 800, 6000],
        ['AMAZON.CO.UK*XYZ', 'Person A', 1200, 9000], ['SHELL SAMPLE', 'Person A', 6000, 9500], ['ODEON SAMPLETOWN', 'Person B', 1800, 4800], ['PRIMARK SAMPLETOWN', 'Person B', 1500, 4000], ['CHAIIWALA SAMPLE', 'Person A', 700, 2500]];
      const ce = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), 19)); const cs = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() - 1, 20));
      const ctx = []; for (let i = 0; i < 26; i++) { const m = merch[rnd(0, merch.length - 1)]; const dd = isoOf(new Date(cs.getTime() + rnd(0, 29) * 864e5)); ctx.push({ date: dd, desc: m[0], amount: -rnd(m[2], m[3]), holder: m[1], account: 'Amex · ' + m[1], kind: 'Card purchase', type: 'card', payee: RD.cleanMerchant(m[0]) }); }
      add({ type: 'amex', institution: 'Amex', name: `Sample Amex ${MON[ce.getUTCMonth()]}`, period: { start: isoOf(cs), end: isoOf(ce) }, summary: { closing: -sum(ctx) }, txns: ctx, holders: ['Person A', 'Person B'], ok: true, problems: [] });
      const ttx = []; for (let i = 0; i < 18; i++) { const m = merch[rnd(0, merch.length - 1)]; const dd = isoOf(new Date(cs.getTime() + (5 + rnd(0, 29)) * 864e5)); ttx.push({ date: dd, desc: m[0], amount: -rnd(m[2], m[3]), holder: 'Person A', account: 'Tesco · Person A', kind: 'Card purchase', type: 'card', payee: RD.cleanMerchant(m[0]) }); }
      add({ type: 'tesco', institution: 'Tesco', name: `Sample Tesco ${MON[ce.getUTCMonth()]}`, period: { start: addDays(isoOf(cs), 5), end: addDays(isoOf(ce), 5) }, summary: { closing: -sum(ttx) }, txns: ttx, holders: ['Person A'], ok: true, problems: [] });
      const pd = d(19); const variable = rnd(0, 1) ? rnd(300000, 700000) : 0; const gross = 1000000 + 55000 + variable;
      const tax = Math.round((gross - 200000) * 0.38), ni = Math.round((gross - 200000) * 0.03), espp = Math.round((1000000 + variable) * 0.03);
      add({ type: 'payslip', institution: 'Acme UK Ltd', name: `Sample payslip ${MON[s.getUTCMonth()]}`, period: { start: pd, end: pd }, payDate: pd, employer: 'Acme UK Ltd', basic: 1000000, car: 55000, variable,
        grossBeforePension: gross, pensionEmployee: 200000, pensionEmployer: 60000, taxablePay: gross - 200000, tax, ni, espp, rsuWithholding: 0, rsuIncome: 0, otherDeductions: 0,
        net: gross - 200000 - tax - ni - espp, items: [], ytd: {}, ok: true, problems: [], txns: [] });
    }
    add({ type: 'moneyfarm', institution: 'Moneyfarm ISA', name: 'Sample ISA Q2', period: { start: '2026-04-01', end: '2026-06-30' }, start: 6000000, end: 6350000, paidIn: 200000, paidOut: 0, investmentReturn: 150000, fees: -9000, isaAllowanceLeft: 1800000, contributions: [{ date: '2026-05-15', amount: 200000 }], ok: true, problems: [], txns: [] });
    add({ type: 'moneyfarm', institution: 'Moneyfarm ISA', name: 'Sample ISA Q3', period: { start: '2026-07-01', end: '2026-09-30' }, start: 6350000, end: 7300000, paidIn: 800000, paidOut: 0, investmentReturn: 150000, fees: -10000, isaAllowanceLeft: 1000000, contributions: [{ date: '2026-07-15', amount: 800000 }], ok: true, problems: [], txns: [] });
    add({ type: 'aviva', institution: 'Pension', name: 'Sample pension', period: { start: '2025-03-01', end: '2026-02-28' }, start: 15000000, paidIn: 3100000, paidOut: 0, growth: 1900000, charges: 45000, end: 19955000, payments: [], projectedPot: 80000000, projectedIncome: 5000000, retirementDate: '1 March 2045', ok: true, problems: [], txns: [] });
    S.files = files; S.demo = true; S.lastSync = null; rebuild();
    statusLine(); render();
  }

  // ---------- UI plumbing ----------
  function status(t) { $('#status').textContent = t; }
  let toastTimer;
  function toast(msg) {
    let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
  }
  function go(view) {
    S.view = view;
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + view; });
    render(); window.scrollTo(0, 0);
  }
  function render() {
    document.body.classList.toggle('locked', S.locked);
    if (S.locked) { document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-home'; }); return renderLock(); }
    ({ home: renderHome, reports: renderReports, pay: renderPay, savings: renderSavings, data: renderData, settings: renderSettings })[S.view]();
  }
  function emptyState(target, what) {
    target.innerHTML = `<div class="card empty">
      ${S.loading ? `<p><b>Reading your statements…</b></p><div class="progress" id="progress"><div style="width:${S.progress * 100}%"></div></div>` : `
      <p><b>${what || 'No statements yet'}</b></p>
      <p class="muted small">Tap <b>Add PDFs</b>, open your statements folder (any folder on your phone, or Google Drive) and choose <b>Select all</b>. Only statements the app hasn't seen before are read.</p>
      <button class="btn" data-act="add-local">Add PDFs</button>
      ${S.txns.length ? '' : `<div><button class="btn ghost" style="margin-top:10px" data-act="demo">Explore with sample data</button></div>`}`}
    </div>`;
  }
  function renderLock() {
    $('#view-home').innerHTML = `<div class="card empty stack">
      <p style="margin:0"><b>Locked</b></p>
      <p class="muted small" style="margin:0">Enter your passcode to open your saved statements.</p>
      <input id="pin" class="input" type="password" inputmode="numeric" autocomplete="current-password" aria-label="Passcode" style="text-align:center;letter-spacing:.3em">
      <button class="btn" data-act="unlock" style="width:100%">Unlock</button>
      <button class="btn ghost" data-act="erase-data" style="width:100%">Forgot it? Erase saved data</button></div>`;
    const i = $('#pin'); i.focus(); i.addEventListener('keydown', e => { if (e.key === 'Enter') $('[data-act=unlock]').click(); });
  }

  // ---------- charts ----------
  function barChart(groups, la = 'Income', lb = 'Spending') { // [{label, a, b}] in pence
    const W = 340, H = 150, padL = 46, padB = 18, padT = 8;
    const max = Math.max(1, ...groups.flatMap(g => [g.a, g.b]));
    const step = (W - padL) / Math.max(1, groups.length); const bw = Math.min(16, step / 3);
    const y = v => H - padB - (Math.max(0, v) / max) * (H - padB - padT);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${la} and ${lb}">`;
    [0, max / 2, max].forEach(t => { s += `<line x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${padL - 4}" y="${y(t) + 3}" text-anchor="end">${gbp0(t)}</text>`; });
    groups.forEach((g, i) => {
      const cx = padL + step * i + step / 2;
      s += `<rect x="${cx - bw - 1}" y="${y(g.a)}" width="${bw}" height="${H - padB - y(g.a)}" rx="2" fill="var(--bar1)"><title>${esc(g.label)} ${la.toLowerCase()} ${gbp(g.a)}</title></rect>`;
      if (g.b !== undefined) s += `<rect x="${cx + 1}" y="${y(g.b)}" width="${bw}" height="${H - padB - y(g.b)}" rx="2" fill="var(--bar2)"><title>${esc(g.label)} ${lb.toLowerCase()} ${gbp(g.b)}</title></rect>`;
      s += `<text x="${cx}" y="${H - 5}" text-anchor="middle">${esc(g.label)}</text>`;
    });
    return s + '</svg>';
  }
  function lineChart(pts, label) { // [{d, v}]
    if (pts.length < 2) return '';
    const W = 340, H = 110, padL = 46, padB = 16, padT = 6;
    const lo = Math.min(0, ...pts.map(p => p.v)), hi = Math.max(1, ...pts.map(p => p.v));
    const x = i => padL + (i / Math.max(1, pts.length - 1)) * (W - padL - 4);
    const y = v => H - padB - ((v - lo) / (hi - lo || 1)) * (H - padB - padT);
    const path = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ');
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">`;
    s += `<line x1="${padL}" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)" stroke-dasharray="${lo < 0 ? '3 3' : '0'}"/><text x="${padL - 4}" y="${y(0) + 3}" text-anchor="end">£0</text>`;
    s += `<text x="${padL - 4}" y="${y(hi) + 3}" text-anchor="end">${gbp0(hi)}</text>`;
    if (lo < 0) s += `<rect x="${padL}" y="${y(0)}" width="${W - padL}" height="${y(lo) - y(0)}" fill="var(--out)" opacity=".08"/><text x="${padL - 4}" y="${y(lo) + 3}" text-anchor="end">${gbp0(lo)}</text>`;
    s += `<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linejoin="round"/>`;
    s += `<text x="${padL}" y="${H - 3}">${niceShort(pts[0].d)}</text><text x="${W}" y="${H - 3}" text-anchor="end">${niceShort(pts[pts.length - 1].d)}</text>`;
    return s + '</svg>';
  }
  function bars(rows, total, act) {
    const max = Math.max(1, ...rows.map(r => r.v));
    return `<div class="bars">${rows.map(r => `<div class="bar" ${act ? `data-act="${act}" data-v="${esc(r.k)}"` : ''}>
      <div class="hd"><span>${esc(r.k)}</span><span class="num">${gbp(r.v)}${total ? ` <span class="muted small">${Math.round(r.v / total * 100)}%</span>` : ''}</span></div>
      <div class="track"><div class="fill ${r.cls || ''}" style="width:${Math.max(0, r.v / max * 100).toFixed(1)}%"></div></div></div>`).join('')}</div>`;
  }
  // Every person gets their own colour, picked automatically from the names found on the statements
  // (alphabetical order, so a person keeps the same colour from month to month). The bank account is always purple.
  const PERSON_COLOURS = ['k1', 'k3', 'k5', 'k6', 'k7', 'k8', 'k2'];
  let _colourFor = null, _colourMap = {};
  function personCls(name) {
    if (name === 'Joint account' || name === 'Joint') return 'k4';
    if (_colourFor !== S.txns) {
      _colourFor = S.txns; _colourMap = {};
      [...new Set(S.txns.map(t => t.holder).filter(h => h && h !== 'Joint' && h !== 'Joint account' && h !== 'Account'))].sort()
        .forEach((h, i) => { _colourMap[h] = PERSON_COLOURS[i % PERSON_COLOURS.length]; });
    }
    return _colourMap[name] || 'k2';
  }

  // ---------- Dashboard ----------
  function renderHome() {
    const el = $('#view-home');
    if (!S.txns.length) return emptyState(el);
    const r = rangeFor(S.period); if (!r) return emptyState(el, 'No bank statements yet');
    const all = S.txns.filter(t => inRange(t, r));
    const offs = all.filter(oneOff);
    const tx = S.hideOneOffs ? all.filter(t => !oneOff(t)) : all;
    const income = sum(tx.filter(t => t.group === 'income'));
    const spendTx = tx.filter(isSpend);
    const spending = -sum(spendTx);
    const saved = -sum(tx.filter(t => t.group === 'saving'));
    const bank = all.filter(t => t.type === 'bank');
    const last = bank[bank.length - 1];
    const low = bank.reduce((m, t) => (!m || t.balance < m.balance ? t : m), null);
    const odDays = new Set(bank.filter(t => t.balance < 0).map(t => t.date)).size;
    const unmatched = all.filter(t => t.repayStatus === 'nocard');
    const latestOf = type => S.statements.filter(s => s.type === type).map(s => s.period.end).sort().pop();
    const synced = S.lastSync ? new Date(S.lastSync).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

    // who spent what
    const byPerson = {};
    spendTx.forEach(t => { const p = personOf(t.account); byPerson[p] = byPerson[p] || { total: 0, acc: {} }; byPerson[p].total -= t.amount; byPerson[p].acc[t.account] = (byPerson[p].acc[t.account] || 0) - t.amount; });
    const people = Object.entries(byPerson).sort((a, b) => b[1].total - a[1].total);
    const maxP = Math.max(1, ...people.map(([, v]) => v.total));
    // by category
    const byCat = {};
    spendTx.forEach(t => { byCat[t.category] = (byCat[t.category] || 0) - t.amount; });
    const catRows = Object.entries(byCat).filter(([, v]) => v > 0).map(([k, v]) => ({ k, v, cls: GROUP_OF[k] === 'cards' ? 'cards' : '' })).sort((a, b) => b.v - a.v);
    // per pay month
    const perCycle = r.keys.map(k => {
      const t2 = S.txns.filter(t => t.cycle === k && (!S.hideOneOffs || !oneOff(t)));
      return { label: cycleShort(k), a: sum(t2.filter(t => t.group === 'income')), b: -sum(t2.filter(isSpend)) };
    });
    // regular payments from the latest bank statement
    const lb = S.statements.filter(s => s.type === 'santander').pop();
    const reg = lb ? S.txns.filter(t => t.type === 'bank' && t.date >= lb.period.start && t.date <= lb.period.end && t.amount < 0 && (t.kind === 'Direct debit' || t.kind === 'Standing order')) : [];
    const regTotal = -sum(reg);
    const byDay = {}; reg.forEach(t => { const d = +t.date.slice(8); byDay[d] = (byDay[d] || 0) - t.amount; });
    const peak = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
    // top payees
    const byPayee = {};
    spendTx.filter(t => t.amount < 0).forEach(t => { byPayee[t.payee] = (byPayee[t.payee] || 0) - t.amount; });
    const payees = Object.entries(byPayee).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const pc = [['latest', 'Pay month'], ['3', '3 months'], ['6', '6 months'], ['12', '12 months'], ['tax', 'Tax year'], ['all', 'All']];

    el.innerHTML = `
      ${S.demo ? `<div class="card notice small">You are looking at <b>invented sample data</b>. Add your statements from the Statements tab.</div>` :
        `<div class="row small"><span class="muted">${S.loading ? 'Reading…' : 'Updated ' + esc(synced)}</span><button class="btn ghost slim" data-act="add-local" ${S.loading ? 'disabled' : ''}>Add statements</button></div>`}
      <div class="chips" role="tablist">${pc.map(([k, l]) => `<button class="chip ${S.period === k ? 'on' : ''}" data-act="period" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="muted small">${esc(r.label)}<br>Bank to ${latestOf('santander') ? niceShort(latestOf('santander')) : '—'} · Amex to ${latestOf('amex') ? niceShort(latestOf('amex')) : '—'} · Tesco to ${latestOf('tesco') ? niceShort(latestOf('tesco')) : '—'}</div>
      <div class="kpis">
        <div class="kpi"><div class="label">Income</div><div class="value in">${gbp0(income)}</div><div class="sub">salary, shares, contributions</div></div>
        <div class="kpi"><div class="label">Spending</div><div class="value out">${gbp0(spending)}</div><div class="sub">bank + all cards${S.hideOneOffs ? ', no one-offs' : ''}</div></div>
        <div class="kpi"><div class="label">Left over</div><div class="value ${income - spending >= 0 ? 'in' : 'out'}">${gbp0(income - spending)}</div><div class="sub">income − spending</div></div>
        <div class="kpi"><div class="label">One-offs</div><div class="value">${gbp0(-sum(offs))}</div><div class="sub">${offs.length} item${offs.length === 1 ? '' : 's'} ≥ £500</div></div>
        <div class="kpi"><div class="label">Into savings (net)</div><div class="value">${gbp0(saved)}</div><div class="sub">savings, ISA, T212, JISA</div></div>
        <div class="kpi"><div class="label">Bank balance</div><div class="value">${last ? gbp0(last.balance) : '—'}</div><div class="sub">${last ? 'at ' + niceShort(last.date) : ''}</div></div>
      </div>
      <div class="card toggle" data-act="toggle-oneoffs" role="switch" aria-checked="${S.hideOneOffs}"><span>Hide one-off payments (£500+)</span><span class="sw ${S.hideOneOffs ? 'on' : ''}"></span></div>
      ${unmatched.length ? `<div class="card notice small">${unmatched.length} card repayment${unmatched.length > 1 ? 's' : ''} (${gbp(-sum(unmatched))}) counted as spending because the card statement for that month isn't in Drive.</div>` : ''}

      <h2>Who spent what</h2>
      <div class="card">${people.map(([p, v]) => `
        <div class="person"><div class="row"><b>${esc(p)}</b><b class="num">${gbp(v.total)}</b></div>
        <div class="stackbar"><i class="${personCls(p)}" style="width:${(v.total / maxP * 100).toFixed(1)}%"></i></div>
        <div class="muted small">${Object.entries(v.acc).sort((a, b) => b[1] - a[1]).map(([a, x]) => `${esc(a === 'Joint account' ? 'Bank' : a.split(' · ')[0])} ${gbp(x)}`).join(' · ')}</div></div>`).join('')}
      </div>

      ${perCycle.length > 1 ? `<h2>Income vs spending by pay month</h2><div class="card chart">${barChart(perCycle)}<div class="legend"><span><i style="background:var(--bar1)"></i>Income</span><span><i style="background:var(--bar2)"></i>Spending</span></div></div>` : ''}

      <h2>Where the money went</h2>
      <div class="card">${catRows.length ? bars(catRows, spending, 'cat') : '<span class="muted">No spending in this period.</span>'}
        <p class="muted small" style="margin:8px 0 0">Tap a category to see its transactions.</p></div>

      ${low ? `<h2>Bank balance</h2><div class="card ${low.balance < 0 ? 'notice bad' : 'notice good'}">
        <div class="row"><b>Lowest</b><span class="num ${low.balance < 0 ? 'out' : ''}">${gbp(low.balance)}</span></div>
        <div class="muted small">${nice(low.date)}${low.balance < 0 ? ` · overdrawn on ${odDays} day${odDays === 1 ? '' : 's'}` : ' · never overdrawn in this period'}</div>
        <div class="chart" style="margin-top:8px">${lineChart(bank.map(t => ({ d: t.date, v: t.balance })), 'Account balance')}</div></div>` : ''}

      ${reg.length ? `<h2>Direct debits &amp; standing orders</h2>
      <div class="card">
        <div class="row"><span>Each month</span><b class="num">${gbp(regTotal)}</b></div>
        ${peak ? `<div class="muted small" style="margin-top:4px">Biggest day: <b>${gbp(peak[1])}</b> leaves on the ${ordinal(+peak[0])}. Have at least this in the account the day before.</div>` : ''}
        <ul class="list" style="margin-top:8px">${reg.slice().sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount).map(t => `<li class="tap" data-act="txn" data-v="${t.key}"><div class="who"><b>${esc(t.payee)}</b><span>${ordinal(+t.date.slice(8))} · ${esc(t.category)}</span></div><span class="num out">${gbp(t.amount)}</span></li>`).join('')}</ul>
      </div>` : ''}

      <h2>Top payees</h2>
      <div class="card"><ul class="list">${payees.map(([p, v]) => `<li class="tap" data-act="payee" data-v="${esc(p)}"><div class="who"><b>${esc(p)}</b></div><span class="num">${gbp(v)}</span></li>`).join('') || '<li class="muted">None</li>'}</ul></div>`;
  }

  // ---------- Reports ----------
  const KINDS = ['Card purchase', 'Direct debit', 'Standing order', 'Card payment', 'Payment out', 'Payment in', 'Bank credit', 'Transfer', 'Cash', 'Card fee/credit', 'Bank charge/credit', 'Other'];
  function applyFilter(f) {
    const terms = f.q.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const min = f.min === '' ? null : Math.round(parseFloat(f.min) * 100);
    const max = f.max === '' ? null : Math.round(parseFloat(f.max) * 100);
    return S.txns.filter(t => {
      if (t.group === 'internal') return false;
      if (f.from && t.date < f.from) return false;
      if (f.to && t.date > f.to) return false;
      if (f.dir === 'out' && t.amount >= 0) return false;
      if (f.dir === 'in' && t.amount <= 0) return false;
      if (f.cats.length && !f.cats.includes(t.category)) return false;
      if (f.kinds.length && !f.kinds.includes(t.kind)) return false;
      if (f.accounts && f.accounts.length && !f.accounts.includes(t.account)) return false;
      const a = Math.abs(t.amount);
      if (min !== null && a < min) return false;
      if (max !== null && a > max) return false;
      if (terms.length) {
        const hay = (t.desc + ' ' + t.payee + ' ' + t.category + ' ' + (t.detail || '')).toLowerCase();
        const hits = terms.map(x => hay.includes(x));
        if (f.match === 'all' ? !hits.every(Boolean) : !hits.some(Boolean)) return false;
      }
      return true;
    });
  }
  function renderReports() {
    const el = $('#view-reports');
    if (!S.txns.length) return emptyState(el);
    const f = S.filter; if (!f.accounts) f.accounts = [];
    const res = applyFilter(f);
    const out = -sum(res.filter(t => t.amount < 0)), inn = sum(res.filter(t => t.amount > 0));
    const byMonth = {}; res.forEach(t => { byMonth[t.cycle] = (byMonth[t.cycle] || 0) + t.amount; });
    const byPayee = {}; res.forEach(t => { byPayee[t.payee] = byPayee[t.payee] || { v: 0, n: 0 }; byPayee[t.payee].v += t.amount; byPayee[t.payee].n++; });
    const payees = Object.entries(byPayee).sort((a, b) => Math.abs(b[1].v) - Math.abs(a[1].v)).slice(0, 12);
    const byAcc = {}; res.forEach(t => { byAcc[t.account] = byAcc[t.account] || { v: 0, n: 0 }; byAcc[t.account].v += t.amount; byAcc[t.account].n++; });
    const accounts = [...new Set(S.txns.filter(t => t.group !== 'internal').map(t => t.account))].sort((a, b) => (a === 'Joint account') - (b === 'Joint account') || a.localeCompare(b));
    const quick = [['latest', 'Pay month'], ['3', '3 months'], ['6', '6 months'], ['tax', 'Tax year'], ['all', 'All dates']];
    const activeCount = (f.cats.length ? 1 : 0) + (f.kinds.length ? 1 : 0) + (f.min || f.max ? 1 : 0);

    el.innerHTML = `
      ${S.presets.length ? `<div class="chips">${S.presets.map((p, i) => `<button class="chip" data-act="preset" data-v="${i}">${esc(p.name)}</button>`).join('')}</div>` : ''}
      <div class="card stack">
        <label class="field">Search (separate several with commas)
          <input id="f-q" type="search" placeholder="e.g. amazon, deliveroo" value="${esc(f.q)}" autocomplete="off"></label>
        <div class="row wrapgap"><div class="seg" id="f-match">${['any', 'all'].map(m => `<button data-v="${m}" class="${f.match === m ? 'on' : ''}">${m === 'any' ? 'Any word' : 'All words'}</button>`).join('')}</div>
          <div class="seg" id="f-dir">${[['out', 'Out'], ['in', 'In'], ['both', 'Both']].map(([k, l]) => `<button data-v="${k}" class="${f.dir === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div><div class="muted small">Account / card</div><div class="chips wrap" style="margin-top:6px">${accounts.map(a => `<button class="chip ${f.accounts.includes(a) ? 'on' : ''}" data-act="facc" data-v="${esc(a)}">${esc(a)}</button>`).join('')}</div></div>
        <div class="grid2">
          <label class="field">From<input id="f-from" type="date" value="${f.from}"></label>
          <label class="field">To<input id="f-to" type="date" value="${f.to}"></label>
        </div>
        <div class="chips">${quick.map(([k, l]) => `<button class="chip" data-act="quick" data-v="${k}">${l}</button>`).join('')}</div>
        <details class="filters" ${activeCount ? 'open' : ''}><summary>More filters${activeCount ? ` (${activeCount} on)` : ''} ▾</summary>
          <div class="stack" style="margin-top:10px">
            <div><div class="muted small">Categories</div><div class="chips wrap" style="margin-top:6px">${CATEGORIES.map(c => `<button class="chip ${f.cats.includes(c.name) ? 'on' : ''}" data-act="fcat" data-v="${esc(c.name)}">${esc(c.name)}</button>`).join('')}</div></div>
            <div><div class="muted small">Payment type</div><div class="chips wrap" style="margin-top:6px">${KINDS.map(k => `<button class="chip ${f.kinds.includes(k) ? 'on' : ''}" data-act="fkind" data-v="${esc(k)}">${esc(k)}</button>`).join('')}</div></div>
            <div class="grid2"><label class="field">Min £<input id="f-min" inputmode="decimal" value="${esc(f.min)}"></label><label class="field">Max £<input id="f-max" inputmode="decimal" value="${esc(f.max)}"></label></div>
          </div></details>
        <div class="row"><button class="btn ghost" data-act="reset">Clear filters</button><button class="btn ghost" data-act="save-preset">Save this report</button></div>
      </div>

      <div class="kpis">
        <div class="kpi"><div class="label">Total out</div><div class="value out">${gbp(out)}</div></div>
        <div class="kpi"><div class="label">Total in</div><div class="value in">${gbp(inn)}</div></div>
        <div class="kpi"><div class="label">Transactions</div><div class="value">${res.length}</div><div class="sub">${res.length ? 'avg ' + gbp((inn - out) / res.length) : ''}</div></div>
      </div>

      ${res.length ? `
      <h2>By account / card</h2>
      <div class="card"><table class="mini"><tr><th>Account</th><th class="r">#</th><th class="r">Total</th></tr>${Object.entries(byAcc).sort((a, b) => a[1].v - b[1].v).map(([a, o]) => `<tr><td>${esc(a)}</td><td class="r">${o.n}</td><td class="r num">${gbp(o.v)}</td></tr>`).join('')}</table></div>
      <h2>By pay month</h2>
      <div class="card"><table class="mini"><tr><th>Pay month</th><th class="r">Net</th></tr>${Object.entries(byMonth).sort().map(([k, v]) => `<tr><td>${cycleLabel(k)}</td><td class="r num ${v < 0 ? 'out' : 'in'}">${gbp(v)}</td></tr>`).join('')}</table></div>
      <h2>By payee</h2>
      <div class="card"><table class="mini"><tr><th>Payee</th><th class="r">#</th><th class="r">Total</th></tr>${payees.map(([p, o]) => `<tr><td>${esc(p)}</td><td class="r">${o.n}</td><td class="r num">${gbp(o.v)}</td></tr>`).join('')}</table></div>
      <h2>Transactions</h2>
      <div class="card"><ul class="list">${res.slice().reverse().slice(0, S.showN).map(txnRow).join('')}</ul>
        ${res.length > S.showN ? `<button class="btn ghost" style="width:100%;margin-top:8px" data-act="more">Show more (${res.length - S.showN})</button>` : ''}</div>` : `<div class="card muted">Nothing matches these filters.</div>`}`;

    const upd = (id, k, ev = 'input') => { const i = $(id); if (i) i.addEventListener(ev, () => { f[k] = i.value; S.showN = 100; rerenderKeepFocus(id); }); };
    upd('#f-q', 'q'); upd('#f-from', 'from', 'change'); upd('#f-to', 'to', 'change'); upd('#f-min', 'min'); upd('#f-max', 'max');
    $('#f-match').addEventListener('click', e => { const v = e.target.dataset.v; if (v) { f.match = v; renderReports(); } });
    $('#f-dir').addEventListener('click', e => { const v = e.target.dataset.v; if (v) { f.dir = v; renderReports(); } });
  }
  let rrTimer;
  function rerenderKeepFocus(id) {
    clearTimeout(rrTimer);
    rrTimer = setTimeout(() => {
      const a = document.activeElement; const pos = a && a.selectionStart;
      const open = document.querySelector('details.filters')?.open;
      renderReports();
      if (open) document.querySelector('details.filters').open = true;
      const n = $(id); if (n) { n.focus(); try { if (pos != null) n.setSelectionRange(pos, pos); } catch { } }
    }, 250);
  }
  function txnRow(t) {
    const acc = t.account === 'Joint account' ? 'Bank' : t.account;
    return `<li class="tap" data-act="txn" data-v="${t.key}"><div class="who"><b>${esc(t.payee)}</b><span>${niceShort(t.date)} ${t.date.slice(0, 4)} · ${esc(acc)} · <span class="pill">${esc(t.category)}</span></span></div><span class="num ${t.amount < 0 ? 'out' : 'in'}">${gbp(t.amount, true)}</span></li>`;
  }

  // ---------- transaction sheet ----------
  function openTxn(key) {
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
  function saveTxn(key) {
    const t = S.txns.find(x => x.key === key); const cat = $('#s-cat').value;
    if ($('#s-all').checked) {
      const text = t.type === 'card' ? t.desc.split(/\s{1,}\d{3,}|\*/)[0].trim().slice(0, 30) || t.payee : t.payee;
      S.rules = S.rules.filter(r => !(r.text.toLowerCase() === text.toLowerCase() && r.dir === (t.amount < 0 ? 'out' : 'in')));
      S.rules.unshift({ text, category: cat, dir: t.amount < 0 ? 'out' : 'in' });
      store.set('rules', S.rules);
    } else { S.overrides[key] = cat; store.set('overrides', S.overrides); }
    recategorise(); $('#sheet').close(); render(); toast('Saved');
  }

  // ---------- Pay (payslips) ----------
  function renderPay() {
    const el = $('#view-pay');
    const ps = S.payslips;
    if (!ps.length) return emptyState(el, 'No payslips yet. Tick your payslips with Pick statements on the Statements tab.');
    if (S.payIdx === null || S.payIdx >= ps.length) S.payIdx = ps.length - 1;
    const p = ps[S.payIdx];
    const gross = p.grossBeforePension;
    const segs = [['Net pay', p.net, 'k1'], ['Tax + NI', p.tax + p.ni + (p.rsuWithholding || 0), 'kr'], ['Pension', p.pensionEmployee, 'k3'], ['ESPP', p.espp, 'k2'], ['Other', p.otherDeductions, 'k4']].filter(s => s[1] > 0);
    const segTotal = sum(segs, s => s[1]) || 1;
    const bankHit = S.txns.find(t => t.type === 'bank' && t.amount === p.net && Math.abs(daysBetween(p.payDate, t.date)) <= 7);
    const ty = p.payDate.slice(5) >= '04-06' ? +p.payDate.slice(0, 4) : +p.payDate.slice(0, 4) - 1;
    const inTy = ps.filter(x => x.payDate >= `${ty}-04-06` && x.payDate <= `${ty + 1}-04-05`);
    const tyPenYou = sum(inTy, x => x.pensionEmployee), tyPenEr = sum(inTy, x => x.pensionEmployer);
    const tyTax = sum(inTy, x => x.tax + (x.rsuWithholding || 0)), tyNi = sum(inTy, x => x.ni), tyNet = sum(inTy, x => x.net), tyGross = sum(inTy, x => x.grossBeforePension), tyEspp = sum(inTy, x => x.espp);
    const notional = (p.items || []).filter(x => x.kind === 'notional');
    const last12 = ps.slice(-12);
    el.innerHTML = `
      <div class="chips">${ps.map((x, i) => `<button class="chip ${i === S.payIdx ? 'on' : ''}" data-act="payslip" data-v="${i}">${MON[+x.payDate.slice(5, 7) - 1]} ${x.payDate.slice(2, 4)}</button>`).slice(-14).join('')}</div>
      <div class="muted small">Paid ${nice(p.payDate)}${p.employer ? ' · ' + esc(p.employer) : ''}${p.ok ? '' : ' · <span class="out">⚠ ' + esc(p.problems[0] || 'check') + '</span>'}</div>
      <h2>Where your pay went</h2>
      <div class="card wf">
        <div class="r"><span>Basic pay</span><span class="num">${gbp(p.basic)}</span></div>
        ${p.car ? `<div class="r"><span>Car allowance</span><span class="num">${gbp(p.car)}</span></div>` : ''}
        ${p.variable ? `<div class="r"><span>Commission / variable</span><span class="num">${gbp(p.variable)}</span></div>` : ''}
        <div class="r"><b>Gross pay</b><b class="num">${gbp(gross)}</b></div>
        <div class="r"><span>Pension (salary sacrifice)</span><span class="num out">−${gbp(p.pensionEmployee)}</span></div>
        <div class="r"><span>Income tax${p.rsuWithholding ? ' (incl. RSU tax)' : ''}</span><span class="num out">−${gbp(p.tax + (p.rsuWithholding || 0))}</span></div>
        <div class="r"><span>National Insurance</span><span class="num out">−${gbp(p.ni)}</span></div>
        ${p.espp ? `<div class="r"><span>ESPP</span><span class="num out">−${gbp(p.espp)}</span></div>` : ''}
        ${p.otherDeductions ? `<div class="r"><span>Other deductions</span><span class="num out">−${gbp(p.otherDeductions)}</span></div>` : ''}
        <div class="r"><b>Net pay</b><b class="num in">${gbp(p.net)}</b></div>
        <div class="stackbar tall">${segs.map(s => `<i class="${s[2]}" style="width:${(s[1] / segTotal * 100).toFixed(1)}%"></i>`).join('')}</div>
        <div class="legend">${segs.map(s => `<span><i class="${s[2]}"></i>${s[0]} ${Math.round(s[1] / segTotal * 100)}%</span>`).join('')}</div>
        <div class="small ${bankHit ? 'in' : 'muted'}" style="margin-top:8px">${bankHit ? `✓ Landed in the joint account on ${niceShort(bankHit.date)}` : 'Not matched to a salary payment in the bank statements yet.'}</div>
      </div>
      ${p.pensionEmployer ? `<div class="card small">Your employer also paid <b>${gbp(p.pensionEmployer)}</b> into your pension this month, so <b>${gbp(p.pensionEmployee + p.pensionEmployer)}</b> went in altogether.</div>` : ''}
      ${p.rsuIncome ? `<div class="card small notice">RSU vest this month: <b>${gbp(p.rsuIncome)}</b> taxed through payroll (shown on the payslip but not paid as cash). The share sale proceeds arrive separately.</div>` : ''}
      ${notional.length ? `<div class="card small muted">Shown on the payslip but not paid: ${notional.map(x => `${esc(x.label)} ${gbp(x.amount)}`).join(' · ')}</div>` : ''}

      <h2>Tax year ${ty}/${String(ty + 1).slice(2)} so far (${inTy.length} payslip${inTy.length === 1 ? '' : 's'})</h2>
      <div class="kpis">
        <div class="kpi"><div class="label">Gross pay</div><div class="value">${gbp0(tyGross)}</div></div>
        <div class="kpi"><div class="label">Net pay</div><div class="value in">${gbp0(tyNet)}</div></div>
        <div class="kpi"><div class="label">Tax + NI</div><div class="value out">${gbp0(tyTax + tyNi)}</div><div class="sub">tax ${gbp0(tyTax)} · NI ${gbp0(tyNi)}</div></div>
        <div class="kpi"><div class="label">Pension</div><div class="value">${gbp0(tyPenYou + tyPenEr)}</div><div class="sub">you ${gbp0(tyPenYou)} + employer ${gbp0(tyPenEr)}</div></div>
        <div class="kpi"><div class="label">ESPP</div><div class="value">${gbp0(tyEspp)}</div></div>
        <div class="kpi"><div class="label">Kept from gross</div><div class="value">${tyGross ? Math.round(tyNet / tyGross * 100) : 0}%</div><div class="sub">net ÷ gross</div></div>
      </div>
      ${last12.length > 1 ? `<h2>Net pay by month</h2><div class="card chart">${barChart(last12.map(x => ({ label: MON[+x.payDate.slice(5, 7) - 1], a: x.net, b: x.variable })), 'Net pay', 'Variable pay')}<div class="legend"><span><i style="background:var(--bar1)"></i>Net pay</span><span><i style="background:var(--bar2)"></i>Commission / variable (gross)</span></div></div>` : ''}`;
    const ch = el.querySelector('.chips'); if (ch) ch.scrollLeft = ch.scrollWidth;
  }

  // ---------- Savings & investments ----------
  function renderSavings() {
    const el = $('#view-savings');
    if (!S.isa.length && !S.pension.length && !S.txns.length) return emptyState(el, 'No investment statements yet');
    const isa = S.isa[S.isa.length - 1];
    const pen = S.pension[S.pension.length - 1];
    const now = today(); const ty = now.slice(5) >= '04-06' ? +now.slice(0, 4) : +now.slice(0, 4) - 1;
    const isaTy = S.isa.flatMap(x => x.contributions || []).filter(c => c.date >= `${ty}-04-06`);
    const isaTyIn = [...new Map(isaTy.map(c => [c.date + c.amount, c])).values()].reduce((s, c) => s + c.amount, 0);
    const penSince = pen ? S.payslips.filter(p => p.payDate > pen.period.end) : [];
    const penSinceAmt = sum(penSince, p => p.pensionEmployee + p.pensionEmployer);
    const savTx = S.txns.filter(t => t.group === 'saving' && t.date >= `${ty}-04-06`);
    const byDest = {}; savTx.forEach(t => { byDest[t.payee] = (byDest[t.payee] || 0) - t.amount; });
    el.innerHTML = `
      <h2>Moneyfarm ISA</h2>
      ${isa ? `<div class="card">
        <div class="row"><span>Value at ${nice(isa.period.end)}</span><b class="num big">${gbp(isa.end)}</b></div>
        <div class="muted small">Quarter: started ${gbp0(isa.start)} · paid in ${gbp0(isa.paidIn)} · return ${gbp(isa.investmentReturn, true)} · fees ${gbp(isa.fees || 0)}</div>
        <div class="chart" style="margin-top:8px">${lineChart(S.isa.map(x => ({ d: x.period.end, v: x.end })), 'ISA value')}</div>
      </div>
      <div class="kpis">
        <div class="kpi"><div class="label">ISA allowance left</div><div class="value">${isa.isaAllowanceLeft !== null && isa.isaAllowanceLeft !== undefined ? gbp0(isa.isaAllowanceLeft) : '—'}</div><div class="sub">per Moneyfarm, ${niceShort(isa.period.end)}</div></div>
        <div class="kpi"><div class="label">Paid in this tax year</div><div class="value">${gbp0(isaTyIn)}</div><div class="sub">from statements</div></div>
        <div class="kpi"><div class="label">Fees (all statements)</div><div class="value">${gbp0(-sum(S.isa, x => x.fees || 0))}</div><div class="sub">${S.isa.length} quarter${S.isa.length === 1 ? '' : 's'}</div></div>
      </div>` : '<div class="card muted small">No Moneyfarm statements yet. Tick them with Pick statements on the Statements tab.</div>'}

      <h2>Workplace pension</h2>
      ${pen ? `<div class="card">
        <div class="row"><span>Value at ${nice(pen.period.end)}</span><b class="num big">${gbp(pen.end)}</b></div>
        <div class="muted small">Year to ${niceShort(pen.period.end)}: started ${gbp0(pen.start)} · paid in ${gbp0(pen.paidIn)} · growth ${gbp(pen.growth, true)} · charges ${gbp(pen.charges)}</div>
        ${penSince.length ? `<div class="small" style="margin-top:8px">Since then your payslips show <b>${gbp(penSinceAmt)}</b> more paid in (${penSince.length} month${penSince.length === 1 ? '' : 's'}, you + employer). The value itself updates when the next annual statement arrives.</div>` : ''}
      </div>
      ${pen.projectedPot ? `<div class="kpis"><div class="kpi"><div class="label">Projected pot</div><div class="value">${gbp0(pen.projectedPot)}</div><div class="sub">at ${esc(pen.retirementDate || 'retirement')}, Aviva's example</div></div>
        <div class="kpi"><div class="label">Example yearly income</div><div class="value">${gbp0(pen.projectedIncome)}</div><div class="sub">in today's money, not guaranteed</div></div></div>` : ''}` : '<div class="card muted small">No pension statement yet. Tick it with Pick statements on the Statements tab.</div>'}

      <h2>From the joint account this tax year</h2>
      <div class="card">${Object.keys(byDest).length ? `<ul class="list">${Object.entries(byDest).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<li><div class="who"><b>${esc(k)}</b></div><span class="num">${gbp(v)}</span></li>`).join('')}</ul><div class="muted small">Net of money taken back out. A negative figure means more came out than went in.</div>` : '<span class="muted small">No savings transfers found.</span>'}</div>`;
  }

  // ---------- Statements ----------
  const TYPES = [['santander', 'Santander', 5], ['amex', 'Amex', 19], ['tesco', 'Tesco CC', 24], ['payslip', 'Payslips', 26]];
  function coverage() {
    const end = today(); const months = [];
    for (let i = 5; i >= 0; i--) { const d = new Date(end + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); months.push(isoOf(d).slice(0, 7)); }
    const rows = TYPES.map(([type, label, day]) => ({ type, label, cells: months.map(m => {
      const st = S.statements.filter(s => s.type === type && s.period.end.slice(0, 7) === m);
      if (st.length) return st.every(s => s.ok) ? 'ok' : 'chk';
      const due = addDays(`${m}-${pad(Math.min(day, 28))}`, 4);
      return end < due ? 'due' : 'miss';
    }) }));
    const missing = [];
    rows.forEach(r => r.cells.forEach((c, i) => { if (c === 'miss') missing.push(`${r.label} ${monthLabel(months[i])}`); }));
    // gaps between consecutive bank statements
    const bank = S.statements.filter(s => s.type === 'santander');
    const gaps = [];
    for (let i = 1; i < bank.length; i++) {
      if (daysBetween(bank[i - 1].period.end, bank[i].period.start) > 3) gaps.push(`${niceShort(addDays(bank[i - 1].period.end, 1))} – ${nice(addDays(bank[i].period.start, -1))}`);
      else if (bank[i - 1].closing !== undefined && bank[i].opening !== undefined && bank[i - 1].closing !== bank[i].opening) gaps.push(`balance doesn't carry over between ${niceShort(bank[i - 1].period.end)} and ${niceShort(bank[i].period.start)}`);
    }
    return { months, rows, missing, gaps };
  }
  function renderData() {
    const el = $('#view-data');
    const cov = S.statements.length ? coverage() : null;
    const repays = S.txns.filter(t => t.repayStatus).slice(-6).reverse();
    const lastIsa = S.isa[S.isa.length - 1], lastPen = S.pension[S.pension.length - 1];
    const badge = c => ({ ok: '<span class="cell ok">✓</span>', chk: '<span class="cell chk">⚠</span>', miss: '<span class="cell miss">✗</span>', due: '<span class="cell na">·</span>' })[c];
    const groups = [['santander', 'Joint account (Santander)'], ['amex', 'Amex'], ['tesco', 'Tesco credit card'], ['payslip', 'Payslips'], ['moneyfarm', 'Moneyfarm ISA'], ['aviva', 'Pension']];
    el.innerHTML = `
      <h2>Add statements</h2>
      <div class="card stack">
        <button class="btn" data-act="add-local" ${S.loading ? 'disabled' : ''}>Add PDFs</button>
        <p class="muted small" style="margin:0">Opens your phone's file chooser. Choose any folder on your phone (such as Downloads) or open <b>Google Drive</b>, then open a statements folder, then <b>⋮ → Select all</b> and tap <b>Select</b>. <b>Or:</b> in the Google Drive app, select the PDFs, tap <b>Share → Ledger</b>. Choose the whole folder every time if you like: the app recognises statements it has already read and only reads new ones. Nothing is uploaded.</p>
      </div>
      ${cov ? `<h2>Statement coverage</h2>
      <div class="card"><div class="grid"><span></span>${cov.months.map(m => `<span class="h">${MON[+m.slice(5) - 1]}</span>`).join('')}
        ${cov.rows.map(r => `<span>${esc(r.label)}</span>${r.cells.map(badge).join('')}`).join('')}</div>
        <p class="muted small" style="margin:10px 0 0">✓ read and adds up · ⚠ read, but a total doesn't match · ✗ missing · · not due yet</p>
        <div class="small" style="margin-top:6px">Moneyfarm: ${lastIsa ? `latest to ${nice(lastIsa.period.end)} ${lastIsa.ok ? '✓' : '⚠'}` : 'none'} · Pension: ${lastPen ? `annual to ${nice(lastPen.period.end)} ${lastPen.ok ? '✓' : '⚠'}` : 'none'}</div></div>
      ${cov.missing.length || cov.gaps.length ? `<div class="card notice small">${cov.missing.length ? `<b>Missing:</b> ${cov.missing.map(esc).join(', ')}.` : ''}${cov.gaps.length ? `<br><b>Gap in bank statements:</b> ${cov.gaps.map(esc).join('; ')}.` : ''}</div>` : `<div class="card notice good small">Everything up to date.</div>`}
      ${repays.length ? `<h2>Card repayments from the joint account</h2><div class="card"><ul class="list">${repays.map(t => `<li class="tap" data-act="txn" data-v="${t.key}"><div class="who"><b>${/AMERICAN EXP|AMEX/i.test(t.desc) ? 'Amex' : 'Tesco'} · paid ${niceShort(t.date)}</b><span>${t.repayStatus === 'matched' ? 'matches the card statement balance' : t.repayStatus === 'covered' ? 'card statements loaded, no exact balance match' : 'no card statement yet: counted as spending'}</span></div><span class="${t.repayStatus === 'matched' ? 'in' : t.repayStatus === 'covered' ? 'muted' : 'out'}">${gbp(-t.amount)} ${t.repayStatus === 'matched' ? '✓' : '?'}</span></li>`).join('')}</ul></div>` : ''}` : ''}

      ${S.ignored.length ? `<div class="card small"><span class="muted">${S.ignored.length} file${S.ignored.length === 1 ? '' : 's'} removed from the app and left out when you add PDFs.</span> <button class="btn ghost slim" data-act="unignore">Use them again</button></div>` : ''}
      ${groups.map(([type, label]) => { const list = S.statements.filter(s => s.type === type).slice().reverse(); return list.length ? `<h2>${label} (${list.length})</h2>
      <div class="card"><ul class="list">${list.map(s => `<li><div class="who"><b>${s.period.start === s.period.end ? nice(s.period.end) : esc(nice(s.period.start)) + ' – ' + esc(nice(s.period.end))}</b><span>${esc(s.name)}${s.count ? ' · ' + s.count + ' transactions' : ''}</span>${s.problems.length ? `<span class="out">${s.problems.map(esc).join('<br>')}</span>` : ''}</div><span class="${s.ok ? 'in' : 'out'}">${s.ok ? '✓' : '⚠'}</span><button class="btn ghost slim" data-act="ignore" data-v="${esc(s.id)}" aria-label="Remove from app">✕</button></li>`).join('')}</ul></div>` : ''; }).join('')}
      ${S.skipped.length ? `<h2>Not used (${S.skipped.length})</h2><div class="card small"><ul class="list">${S.skipped.map(s => `<li><div class="who"><b>${esc(s.name)}</b><span>${esc(s.why)}</span></div>${s.id ? `<button class="btn ghost slim" data-act="ignore" data-v="${esc(s.id)}" aria-label="Remove from app">✕</button>` : ''}</li>`).join('')}</ul></div>` : ''}
      ${S.txns.length && !S.demo ? `<div class="card notice good small"><b>Saved on this phone, encrypted${S.meta && S.meta.mode === 'pin' ? ' and locked with your passcode' : ''}.</b> The statement PDFs themselves are never saved.</div>` : ''}`;
  }

  // ---------- Settings ----------
  function renderSettings() {
    const el = $('#view-settings');
    el.innerHTML = `
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
        <div class="row"><span class="muted">Erase saved statements. Your settings and rules stay, and you add the PDFs again.</span><button class="btn danger" data-act="erase-data">Erase</button></div>`}
      </div>

      <h2>Privacy</h2>
      <div class="card stack small">
        <div>• Statement PDFs are read in this phone's memory, then discarded. The PDFs are never saved or uploaded.</div>
        <div>• What's read from them is saved on this phone with AES-256 encryption, so the app opens straight away and only new statements are read.</div>
        <div>• No server, no analytics, no AI. After it loads, the app doesn't contact anyone.</div>
        <div>• Also saved on this phone: the settings above, your rules, saved reports, and category corrections (stored as one-way hashes).</div>
        <div class="row"><span></span><button class="btn danger" data-act="forget">Forget everything</button></div>
      </div>
      <p class="muted small" style="text-align:center">Household Ledger v2.3 · bank, cards, payslips, ISA and pension</p>`;
    let dir = '';
    $('#r-dir').addEventListener('click', e => { if (e.target.dataset.v === undefined) return; dir = e.target.dataset.v; [...$('#r-dir').children].forEach(b => b.classList.toggle('on', b === e.target)); });
    $('[data-act="add-rule"]').addEventListener('click', () => {
      const text = $('#r-text').value.trim(); if (!text) return toast('Enter some text to match.');
      S.rules.unshift({ text, category: $('#r-cat').value, dir: dir || undefined }); store.set('rules', S.rules); recategorise(); renderSettings(); toast('Rule added');
    });
    $('#r-file').addEventListener('change', async e => { const f = e.target.files[0]; if (f) $('#r-json').value = await f.text(); });
    $('#theme').addEventListener('click', e => { const v = e.target.dataset.v; if (!v) return; store.set('theme', v); applyTheme(); renderSettings(); });
  }
  function applyTheme() { const t = store.get('theme', 'auto'); if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t; }

  // ---------- events ----------
  document.addEventListener('click', async e => {
    const tab = e.target.closest('[data-view]'); if (tab) { if (!S.locked) go(tab.dataset.view); return; }
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'add-rule') return;
    const v = a.dataset.v; const f = S.filter;
    try {
      switch (a.dataset.act) {
        case 'go-settings': return go('settings');
        case 'demo': return loadDemo();
        case 'add-local': return chooseLocalFiles();
        case 'ignore': {
          if (!confirm('Stop using this file in the app? (The PDF itself is untouched wherever you keep it.)')) return;
          S.ignored = [...new Set(S.ignored.concat(v))]; store.set('ignored', S.ignored);
          delete S.files[v]; await saveVault(); rebuild(); return render();
        }
        case 'unignore': S.ignored = []; store.set('ignored', S.ignored); renderData(); return toast('Add the PDFs again to read them.');
        case 'unlock': {
          const pin = $('#pin').value; if (!pin) return;
          a.disabled = true;
          try { await openVault(await keyFromPin(pin, S.meta.salt)); } catch { a.disabled = false; $('#pin').value = ''; return toast('Wrong passcode'); }
          statusLine(); go('home'); return checkInbox();
        }
        case 'lock': return lock();
        case 'change-pin': { const pin = await askNewPin(S.meta && S.meta.mode === 'pin'); if (pin === undefined) return; if (pin === null && S.meta && S.meta.mode !== 'pin') return; await setPin(pin); renderSettings(); return toast(pin ? 'Passcode set' : 'Saved without a passcode'); }
        case 'remove-pin': if (!confirm('Remove the passcode? Anyone who can open this app on your phone will see your saved statements.')) return; await setPin(null); renderSettings(); return toast('Passcode removed');
        case 'erase-data':
          if (!confirm('Erase the saved statements from this phone? Your settings and rules are kept. You add the PDFs again to read them.')) return;
          await idb.clear(); S.files = {}; S.key = null; S.meta = null; S.locked = false; S.lastSync = null; rebuild(); statusLine(); return go('home');
        case 'period': S.period = v; return renderHome();
        case 'toggle-oneoffs': S.hideOneOffs = !S.hideOneOffs; store.set('hideOneOffs', S.hideOneOffs); return renderHome();
        case 'cat': { const r = rangeFor(S.period); S.filter = Object.assign(blankFilter(), { cats: [v], from: r.from, to: r.to, dir: 'both' }); return go('reports'); }
        case 'payee': { const r = rangeFor(S.period); S.filter = Object.assign(blankFilter(), { q: v, from: r.from, to: r.to }); return go('reports'); }
        case 'payslip': S.payIdx = +v; return renderPay();
        case 'txn': return openTxn(v);
        case 'sheet-close': return $('#sheet').close();
        case 'sheet-save': return saveTxn(v);
        case 'quick': { const r = rangeFor(v); if (r) { f.from = r.from; f.to = r.to; } return renderReports(); }
        case 'facc': f.accounts = f.accounts.includes(v) ? f.accounts.filter(x => x !== v) : f.accounts.concat(v); return renderReports();
        case 'fcat': f.cats = f.cats.includes(v) ? f.cats.filter(x => x !== v) : f.cats.concat(v); renderReports(); document.querySelector('details.filters').open = true; return;
        case 'fkind': f.kinds = f.kinds.includes(v) ? f.kinds.filter(x => x !== v) : f.kinds.concat(v); renderReports(); document.querySelector('details.filters').open = true; return;
        case 'reset': S.filter = blankFilter(); return renderReports();
        case 'more': S.showN += 200; return renderReports();
        case 'save-preset': { const name = prompt('Name this report', f.q || (f.cats[0] || 'My report')); if (!name) return; S.presets.push({ name, filter: JSON.parse(JSON.stringify(f)) }); store.set('presets', S.presets); renderReports(); return toast('Saved. It appears at the top of Reports.'); }
        case 'preset': S.filter = Object.assign(blankFilter(), JSON.parse(JSON.stringify(S.presets[+v].filter))); return renderReports();
        case 'del-preset': S.presets.splice(+v, 1); store.set('presets', S.presets); return renderSettings();
        case 'del-rule': S.rules.splice(+v, 1); store.set('rules', S.rules); recategorise(); return renderSettings();
        case 'import-rules': {
          let arr; try { arr = JSON.parse($('#r-json').value); } catch { return toast('That is not valid JSON.'); }
          if (!Array.isArray(arr)) arr = arr.rules;
          const ok = (arr || []).filter(r => r && typeof r.text === 'string' && GROUP_OF[r.category]).map(r => ({ text: r.text, category: r.category, dir: r.dir === 'in' || r.dir === 'out' ? r.dir : undefined }));
          if (!ok.length) return toast('No valid rules found.');
          const seen = new Set(S.rules.map(r => r.text.toLowerCase() + '|' + r.dir));
          S.rules = S.rules.concat(ok.filter(r => !seen.has(r.text.toLowerCase() + '|' + r.dir)));
          store.set('rules', S.rules); recategorise(); renderSettings(); return toast(`Imported ${ok.length} rules`);
        }
        case 'copy-rules': await navigator.clipboard.writeText(JSON.stringify(S.rules, null, 1)); return toast('Rules copied');
        case 'forget':
          if (!confirm('Remove all saved statements, settings, sources, rules and saved reports from this phone?')) return;
          store.clear(); await idb.clear(); location.reload(); return;
      }
    } catch (err) { toast(err.message || String(err)); }
  });
  $('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet' && !S.sheetLocked) $('#sheet').close(); });
  $('#sheet').addEventListener('cancel', e => { if (S.sheetLocked) e.preventDefault(); });
  // Auto-lock after 5 minutes in the background (passcode mode only).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) S.hiddenAt = Date.now();
    else if (S.hiddenAt && Date.now() - S.hiddenAt > 5 * 60e3 && !S.loading) lock();
  });

  async function start() {
    applyTheme();
    // Clean out settings left behind by earlier versions (Google sync no longer exists).
    try { ['config', 'lastParent', 'sources'].forEach(k => localStorage.removeItem('ledger.' + k)); } catch { }
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => reg.update()).catch(() => { });
      // When a new version of the app has installed itself, reload once so you're running it.
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded && !S.loading) { reloaded = true; location.reload(); } });
    }
    if (new URLSearchParams(location.search).has('demo')) { try { S.meta = await idb.get('meta') || null; } catch { } return loadDemo(); }
    try {
      S.meta = await idb.get('meta') || null;
      if (S.meta && S.meta.mode === 'device') await openVault(S.meta.key);
      else if (S.meta && S.meta.mode === 'pin') S.locked = true;
    } catch (e) { toast('Could not open the saved data: ' + e.message); }
    statusLine(); render();
    if (new URLSearchParams(location.search).has('shared')) { history.replaceState(null, '', location.pathname); if (!S.locked) go('data'); }
    checkInbox();
  }
  start();
})();
