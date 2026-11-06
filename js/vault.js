/* Saved data: encrypted on this phone (IndexedDB), the passcode, and locking. */
import { rebuild } from './model.js';
import { S } from './state.js';
import { go, statusLine, toast } from './ui.js';
import { $ } from './util.js';

export const PARSER_VERSION = 3; // bump when a reader changes, so old statements are read again

const enc = new TextEncoder(), dec = new TextDecoder();

export const idb = {
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

export async function keyFromPin(pin, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function saveVault() {
  if (!S.key || S.demo) return;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, S.key, enc.encode(JSON.stringify({ files: S.files, lastSync: S.lastSync, lastImport: S.lastImport })));
  await idb.put('vault', { iv, ct, saved: Date.now() });
}

export async function openVault(key) {
  const v = await idb.get('vault');
  if (v) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: v.iv }, key, v.ct); // fails if the passcode is wrong
    const j = JSON.parse(dec.decode(pt));
    S.files = j.files || {}; S.lastSync = j.lastSync || null; S.lastImport = j.lastImport || null;
  }
  S.key = key; S.locked = false; S.demo = false;
  rebuild();
}

export async function setPin(pin) {
  if (pin) { const salt = crypto.getRandomValues(new Uint8Array(16)); S.key = await keyFromPin(pin, salt); S.meta = { mode: 'pin', salt }; }
  else { S.key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); S.meta = { mode: 'device', key: S.key }; }
  await idb.put('meta', S.meta); await saveVault();
}

export function askNewPin(change) {
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

export async function ensureKey() { if (!S.key) await setPin(await askNewPin(false)); }

export function lock() {
  if (!S.meta || S.meta.mode !== 'pin') return;
  S.key = null; S.files = {}; S.lastImport = null; S.txns = []; S.statements = []; S.skipped = []; S.payslips = []; S.isa = []; S.pension = []; S.locked = true;
  if ($('#sheet').open) { S.sheetLocked = false; $('#sheet').close(); }
  statusLine(); go('home');
}
