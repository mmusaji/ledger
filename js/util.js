/* Small shared helpers: formatting money and dates, escaping text for HTML, and saved settings (localStorage). */

export const $ = s => document.querySelector(s);

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const gbp = (p, sign) => {
  const s = '£' + (Math.abs(p) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (sign && p > 0) return '+' + s;
  return p < 0 ? '−' + s : s;
};

export const gbp0 = p => (p < 0 ? '−' : '') + '£' + Math.round(Math.abs(p) / 100).toLocaleString('en-GB');

export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const nice = iso => { const [y, m, d] = iso.split('-'); return `${+d} ${MON[+m - 1]} ${y}`; };

export const niceShort = iso => { const [, m, d] = iso.split('-'); return `${+d} ${MON[+m - 1]}`; };

export const monthLabel = k => { const [y, m] = k.split('-'); return `${MON[+m - 1]} ${y}`; };

export const ordinal = n => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

export const pad = n => String(n).padStart(2, '0');

export const isoOf = d => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());

export const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); };

export const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);

export const today = () => isoOf(new Date());

export const sum = (arr, f = t => t.amount) => arr.reduce((s, t) => s + f(t), 0);

export const personOf = acc => (acc && acc.includes(' · ')) ? acc.split(' · ')[1] : 'Joint account';

export const ONE_OFF = 50000; // £500

export const store = {
  get(k, d) { try { const v = localStorage.getItem('ledger.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ledger.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  clear() { try { Object.keys(localStorage).filter(k => k.startsWith('ledger.')).forEach(k => localStorage.removeItem(k)); } catch { } }
};

// FNV-1a: corrections are stored against a hash, so no amounts or descriptions are written in clear.
function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }

export const baseKey = t => hash(`${t.date}|${t.amount}|${t.balance ?? ''}|${t.desc}|${t.account || ''}`);

export const keyOf = t => t.key;
