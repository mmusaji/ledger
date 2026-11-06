/* How an import is shown: the result sheet right after adding files, and the "Last import" card on the Statements screen. */
import { MARK_TEXT } from './pipeline.js';
import { esc, nice } from './util.js';

const span = p => !p ? '' : p.start === p.end ? nice(p.end) : nice(p.start) + ' – ' + nice(p.end);

export function importBody(sum) {
  const nA = sum.added.length, nF = sum.failed.length;
  const head = [`<b>${nA} added</b>`, sum.known ? `${sum.known} already had` : '', sum.ignored ? `${sum.ignored} left out (removed earlier)` : '', nF ? `<b class="out">${nF} couldn't be read</b>` : ''].filter(Boolean).join(' · ');
  const marks = [...new Set(sum.added.map(a => a.mark))].filter(m => MARK_TEXT[m] && sum.added.some(a => a.mark === m && a.kind === 'csv'));
  return `<div class="small" style="margin-bottom:8px">${head}</div>
    ${nA ? `<ul class="list">${sum.added.map(a => `<li><div class="who"><b>${esc(a.name)}</b><span>${esc(a.label || '')}${a.rows ? ' · ' + a.rows + ' transactions' : ''}${a.period ? ' · ' + esc(span(a.period)) : ''}</span></div><span class="${{ '✓': 'in', '○': 'muted' }[a.mark] || 'out'}" style="font-size:18px" title="${esc(MARK_TEXT[a.mark] || '')}">${esc(a.mark)}</span></li>`).join('')}</ul>` : ''}
    ${marks.length ? `<p class="muted small" style="margin:8px 0 0">${marks.map(m => `${m} ${esc(MARK_TEXT[m])}`).join('<br>')}</p>` : ''}
    ${nF ? `<div class="card notice bad small" style="margin-top:10px"><b>Not added (nothing from these was saved):</b><ul class="list">${sum.failed.map(f => `<li><div class="who"><b>${esc(f.name)}</b><span>${esc(f.why)}</span><br><span>${esc(f.hint || '')}</span></div></li>`).join('')}</ul></div>` : ''}`;
}

export function importSheet(sum) {
  return `<div class="stack"><b style="font-size:17px">Import finished</b>${importBody(sum)}
    <div class="row"><button class="btn" data-act="sheet-close">Done</button></div></div>`;
}

export function lastImportCard(sum) {
  if (!sum) return '';
  const when = new Date(sum.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `<h2>Last import <span class="muted small">· ${esc(when)}</span></h2><div class="card ${sum.failed.length ? 'notice' : 'notice good'}">${importBody(sum)}
    <div class="row" style="margin-top:8px"><button class="btn ghost slim" data-act="dismiss-import">Dismiss</button></div></div>`;
}
