/* The import pipeline: decide what a chosen file is, read it, and report what happened. Pure logic with no page or
 * storage access, so it can be tested in Node. Nothing here changes the saved statements: the caller stores `entry`
 * for files that came back "added" and keeps everything else out.
 *
 * One file in, one outcome out:
 *   added    read well enough to keep (`entry` is what gets saved)
 *   known    these exact bytes were read before (same parser version)
 *   ignored  removed from the app earlier and left out
 *   failed   could not be read: NOT kept, with a plain reason and what to try instead
 */
export const HINT_CSV = 'Download the CSV of the same statement from your bank and add that instead.';

export const fileIdOf = async bytes => {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return 'local:' + [...d.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
};

/** What the bytes are: 'pdf' | 'csv' | 'unknown'. The extension is only a tie-break for tiny files; a CSV renamed
 *  .pdf (or the other way round) is still routed by what is inside it. */
export const kindOf = (bytes, CSVR) => CSVR.sniff(new Uint8Array(bytes));

/** How much a CSV result proves, as one mark. ✓ checked against its own balances, ○ read but nothing to check it
 *  against, ⚠ read with a problem. */
export function csvMark(r) {
  if (r.problems && r.problems.length) return '⚠';
  return r.confidence === 'verified' ? '✓' : '○';
}
export const MARK_TEXT = { '✓': 'checked: every row adds up against the running balance', '○': 'read, but not checked: this file has no balance to check it against', '⚠': 'read, with a problem' };

/** A CSV result in the shape the saved statements use. Held as "waiting for account setup" until it has been given an
 *  account (Stage 2), so it never reaches the figures on its own. */
export function csvResult(r, id) {
  return { type: 'csv', institution: r.institution, period: r.period, txns: r.txns, ok: r.confidence === 'verified', confidence: r.confidence,
    accountType: r.accountType || 'unknown', accountTypeWhy: r.accountTypeWhy || '', problems: r.problems || [], notes: r.notes || [],
    convention: r.convention || '', rows: r.txns.length, account: { id: 'csvfile:' + id.slice(6) }, holders: [], mark: csvMark(r) };
}

/** `ctx`: { files, ignored, version, CSVR, RD, extractPages(bytes) }  `file`: { name, arrayBuffer() }  */
export async function readOne(file, ctx) {
  const name = file.name;
  try {
    let bytes = await file.arrayBuffer();
    const id = await fileIdOf(bytes);
    if (ctx.ignored.includes(id)) return { name, id, status: 'ignored' };
    if (ctx.files[id] && ctx.files[id].v === ctx.version) return { name, id, status: 'known' };
    const kind = kindOf(bytes, ctx.CSVR);
    const entry = { name, md5: '', modified: '', v: ctx.version, src: 'local' };
    if (kind === 'pdf') {
      const pages = await ctx.extractPages(bytes);
      bytes = null; // the PDF itself is dropped as soon as it has been read
      const r = ctx.RD.readStatement(pages, name);
      if (!r.period || r.type === 'unsupported' || r.type === 'unreadable') {
        const scan = r.type === 'unreadable';
        return { name, id, kind, status: 'failed', why: scan ? 'This PDF is a scan or picture with no readable text, so it is not supported.' : 'This PDF is not a statement layout the app reads.', hint: HINT_CSV };
      }
      // a money statement that found no transactions and does not add up was not read, whatever else it found
      if (!r.ok && !(r.txns || []).length && ['santander', 'amex', 'tesco', 'monzo'].includes(r.type)) return { name, id, kind, status: 'failed', why: 'No transactions could be read from this PDF.', hint: HINT_CSV };
      entry.result = r;
      return { name, id, kind, status: 'added', entry, mark: r.ok ? '✓' : '⚠', rows: (r.txns || []).length, period: r.period, label: r.institution || r.type };
    }
    if (kind === 'csv') {
      const r = ctx.CSVR.read(new Uint8Array(bytes), name); bytes = null;
      if (r.confidence === 'failed' || !r.period || !r.txns.length) return { name, id, kind, status: 'failed', why: (r.problems && r.problems[0]) || 'This CSV could not be read safely.', hint: 'Try the PDF of the same statement, or check that this is the statement export (dates, amounts and descriptions).' };
      entry.result = csvResult(r, id);
      return { name, id, kind, status: 'added', entry, mark: entry.result.mark, rows: r.txns.length, period: r.period, label: 'CSV · ' + (r.accountType === 'card' ? 'card' : r.accountType === 'current' ? 'current account' : 'account type unclear') };
    }
    return { name, id, kind, status: 'failed', why: 'This is not a PDF or a CSV statement.', hint: 'The app reads statement PDFs and statement CSVs.' };
  } catch (e) { return { name, status: 'failed', why: 'Could not read this file (' + e.message + ').', hint: HINT_CSV }; }
}

/** The summary shown in the result sheet and kept as "Last import". Failed files are listed by name and reason only. */
export function summarise(outcomes, at) {
  const by = s => outcomes.filter(o => o.status === s);
  return {
    at: at || new Date().toISOString(),
    added: by('added').map(o => ({ name: o.name, kind: o.kind, mark: o.mark, rows: o.rows, period: o.period, label: o.label })),
    known: by('known').length, ignored: by('ignored').length,
    failed: by('failed').map(o => ({ name: o.name, why: o.why, hint: o.hint }))
  };
}
