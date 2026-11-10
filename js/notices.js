/* A short notice at the top of the Dashboard and Reports when the figures include something that could not be fully checked. */
import { S } from './state.js';
import { esc, nice } from './util.js';

const MONEY = ['santander', 'amex', 'tesco', 'monzo'];

/** Statements that are counted in the figures although their totals did not add up and nobody has said they are fine. */
export const unresolved = () => S.statements.filter(s => MONEY.includes(s.type) && !s.ok && !s.acked && !s.held);
export const leftOut = () => S.statements.filter(s => s.held);

export function figuresNotice() {
  const bad = unresolved(), out = leftOut(); if (!bad.length && !out.length) return '';
  const label = s => `${esc(s.institution || s.type)} ${nice(s.period.end).slice(2)}`;
  return `<div class="card notice small">
    ${bad.length ? `<b>${bad.length} statement${bad.length === 1 ? '' : 's'} counted here did not add up</b> (${bad.slice(0, 3).map(label).join(', ')}${bad.length > 3 ? '…' : ''}). Totals for those months could be off.<br>` : ''}
    ${out.length ? `<b>${out.length} statement${out.length === 1 ? ' is' : 's are'} left out of these figures</b> (${out.slice(0, 3).map(label).join(', ')}${out.length > 3 ? '…' : ''}), so those months show less.<br>` : ''}
    <button class="btn ghost slim" data-view="data" style="margin-top:6px">Review in Documents</button></div>`;
}
