/* Small chart and bar drawing helpers, and a colour for each person. */
import { S } from './state.js';
import { accountName, activeScope, hasPersonal, personalAccounts } from './model.js';
import { esc, gbp, gbp0, niceShort } from './util.js';

export function barChart(groups, la = 'Income', lb = 'Spending') { // [{label, a, b}] in pence
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

export function lineChart(pts, label) { // [{d, v}]
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

export function bars(rows, total, act) {
  const max = Math.max(1, ...rows.map(r => r.v));
  return `<div class="bars">${rows.map(r => `<div class="bar" ${act ? `data-act="${act}" data-v="${esc(r.k)}"` : ''}>
    <div class="hd"><span>${esc(r.k)}</span><span class="num">${gbp(r.v)}${total ? ` <span class="muted small">${Math.round(r.v / total * 100)}%</span>` : ''}</span></div>
    <div class="track"><div class="fill ${r.cls || ''}" style="width:${Math.max(0, r.v / max * 100).toFixed(1)}%"></div></div></div>`).join('')}</div>`;
}

// Every person gets their own colour, picked automatically from the names found on the statements
// (alphabetical order, so a person keeps the same colour from month to month). The bank account is always purple.
const PERSON_COLOURS = ['k1', 'k3', 'k5', 'k6', 'k7', 'k8', 'k2'];

let _colourFor = null, _colourMap = {};

export function personCls(name) {
  if (name === 'Joint account' || name === 'Joint') return 'k4';
  if (_colourFor !== S.txns) {
    _colourFor = S.txns; _colourMap = {};
    [...new Set(S.txns.map(t => t.holder).filter(h => h && h !== 'Joint' && h !== 'Joint account' && h !== 'Account'))].sort()
      .forEach((h, i) => { _colourMap[h] = PERSON_COLOURS[i % PERSON_COLOURS.length]; });
  }
  return _colourMap[name] || 'k2';
}

/** Household / personal account switch. Only shown once a personal account has been added. */
export function scopeBar() {
  if (!hasPersonal()) return '';
  const sc = activeScope();
  const chips = [['household', 'Household'], ...personalAccounts().map(a => [a.id, accountName(a)])];
  return `<div class="chips wrap" role="tablist" aria-label="View">${chips.map(([k, l]) => `<button class="chip ${sc === k ? 'on' : ''}" data-act="scope" data-v="${k}">${esc(l)}</button>`).join('')}</div>`;
}
