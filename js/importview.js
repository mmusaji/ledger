/* How an import is shown: the result sheet right after adding files, and the "Last import" card on the Statements screen. */
import { MARK_TEXT } from './pipeline.js';
import { esc, nice } from './util.js';

const span = p => !p ? '' : p.start === p.end ? nice(p.end) : nice(p.start) + ' – ' + nice(p.end);
const markCls = m => ({ '✓': 'in', '○': 'muted' }[m] || 'out');

export function importBody(sum) {
  const nA = sum.added.length, nF = sum.failed.length || sum.failedCount || 0;
  const head = [`<b>${nA} added</b>`, sum.known ? `${sum.known} already had` : '', sum.ignored ? `${sum.ignored} left out (removed earlier)` : '', nF ? `<b class="out">${nF} couldn't be read</b>` : ''].filter(Boolean).join(' · ');
  const marks = [...new Set(sum.added.map(a => a.mark))].filter(m => MARK_TEXT[m] && sum.added.some(a => a.mark === m && a.kind === 'csv'));
  const dups = sum.added.reduce((s, a) => s + (a.overlap ? a.overlap.dup : 0), 0), differs = sum.added.reduce((s, a) => s + (a.overlap ? a.overlap.differs : 0), 0);
  const row = a => `<li><div class="who"><b>${esc(a.name)}</b><span>${a.kind === 'csv' ? 'CSV' : esc(a.label || 'PDF')}${a.rows ? ' · ' + a.rows + ' transactions' : ''}${a.period ? ' · ' + esc(span(a.period)) : ''}</span>
      ${a.acct ? `<span>→ <b>${esc(a.acct)}</b>${a.remembered ? ' (remembered from last time)' : ''}</span>` : a.waiting ? '<span class="out">Waiting for an account name: not in your figures yet</span>' : ''}
      ${a.overlap && a.overlap.dup ? `<span>${a.overlap.dup} row${a.overlap.dup === 1 ? '' : 's'} already counted from ${esc(a.overlap.with.join(', '))}, not counted twice</span>` : ''}
      ${a.overlap && a.overlap.differs ? `<span class="out">${a.overlap.differs} row${a.overlap.differs === 1 ? '' : 's'} in the overlap did not match and were kept</span>` : ''}</div>
      <span class="${markCls(a.mark)}" style="font-size:18px" title="${esc(MARK_TEXT[a.mark] || '')}">${esc(a.mark)}</span></li>`;
  return `<div class="small" style="margin-bottom:8px">${head}</div>
    ${dups ? `<div class="small muted" style="margin-bottom:6px">${dups} overlapping row${dups === 1 ? '' : 's'} across these files counted once${differs ? `, ${differs} that differ kept` : ''}.</div>` : ''}
    ${nA ? `<ul class="list">${sum.added.map(row).join('')}</ul>` : ''}
    ${marks.length ? `<p class="muted small" style="margin:8px 0 0">${marks.map(m => `${m} ${esc(MARK_TEXT[m])}`).join('<br>')}</p>` : ''}
    ${sum.failed.length ? `<div class="card notice bad small" style="margin-top:10px"><b>Not added (nothing from these was saved):</b><ul class="list">${sum.failed.map(f => `<li><div class="who"><b>${esc(f.name)}</b><span>${esc(f.why)}</span><br><span>${esc(f.hint || '')}</span></div></li>`).join('')}</ul></div>`
      : sum.failedCount ? `<div class="card notice bad small" style="margin-top:10px">${sum.failedCount} file${sum.failedCount === 1 ? '' : 's'} could not be read and nothing from ${sum.failedCount === 1 ? 'it was' : 'them was'} saved. File names are not kept: add them again after a fix.</div>` : ''}`;
}

export function importSheet(sum) {
  return `<div class="stack"><b style="font-size:17px">Import finished</b>${importBody(sum)}
    <div class="row">${sum.undo ? '<button class="btn ghost" data-act="undo-import">Undo this import</button>' : ''}<button class="btn" data-act="sheet-close">Done</button></div></div>`;
}

export function lastImportCard(sum) {
  if (!sum) return '';
  const when = new Date(sum.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `<h2>Last import <span class="muted small">· ${esc(when)}</span></h2><div class="card ${(sum.failed.length || sum.failedCount) ? 'notice' : 'notice good'}">${importBody(sum)}
    <div class="row" style="margin-top:8px">${sum.undo ? '<button class="btn ghost slim" data-act="undo-import">Undo this import</button>' : ''}<button class="btn ghost slim" data-act="dismiss-import">Dismiss</button></div></div>`;
}
