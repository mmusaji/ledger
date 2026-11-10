# Smart parser: design

Status: **built and released in v4.1.** `readers/smart.js` is the last-resort PDF reader (only verified results are kept) and `readers/csv.js` reads CSV exports; the screens followed `IMPORT-FLOW-DESIGN.md`. Kept as the design record. Not built from this document: the Web Worker, page and time budgets and the separate reader version number (section 4), and the larger mutation and performance suites (section 6, items 3 and 5).

Status: **design only. Nothing here is wired into the app.** The app's current behaviour, readers, storage and screens do not change
as part of this work. Everything below applies to this one feature, and only if we decide to build it.

## 1. Goal and non-goals

**Goal:** read statements from UK banks and cards the app has no dedicated reader for, with no bank-specific code, and only
ever accept a result that proves itself against the statement's own arithmetic.

**Non-goals**
- No change to the existing readers (Santander, Amex, Tesco, Monzo, payslips, ISA, pension), their output, or how they are chosen.
- No change to storage format, categories, rules, scopes or any screen, apart from a clearly separate "read with the generic reader" preview (section 5).
- No server, no upload, no AI model. Everything stays on the device.
- No OCR. Scanned (picture-only) PDFs stay "unreadable".
- Not US statements (month-first dates, dollars): refused on purpose.

## 2. How the reader works (already prototyped in `readers/smart.js`)

1. Group pdf.js text items into rows, merge touching items into cells.
2. Find a table header made only of header words (Date / Description / Money in / Money out / Amount / Balance...). Prose that merely mentions "date" is not a header.
3. Read rows under the header. Handle: date printed once per day, two-line descriptions, posting dates and reference columns, CR/DR markers, brought/carried-forward rows, repeated headers on each page, notices beside the table.
4. Try a few readings (how undated rows behave; bank vs card sign convention) and **prove each against the statement**: running balances, opening + transactions = closing, printed money in/out, and the statement's own summary.
5. Outcomes: `verified` / `unverified` (rows read, nothing to prove them) / `failed`. Only `verified` is ever eligible for import.

Money is whole pence (integers), never floats.

## 3. Safety rules (the part that matters most)

- **False-verified must be zero.** A wrong result that reports "verified" is the one failure that could corrupt data. `failed` and `unverified` are safe outcomes.
- The generic reader runs **only after every existing reader says "not mine"**. It can never override or replace one.
- Import only `verified` results. How and whether the user is asked is open (section 5).
- A setting turns it off completely. Off by default until the test targets in section 6 are met.
- Refuse rather than guess: month-first dates, dollars, all-zero placeholder statements, statements whose own summary does not add up.
- Any exception inside it is caught and treated as "not read"; it must not be able to break the existing import path.

## 4. Performance design

Measured on a desktop (110 pages, 11 PDFs): pdf.js extraction about 15 ms/page; the generic reader about 2 ms/page; heap about 36 MB.
On a phone, assume 5 to 10 times slower (estimate, not measured). So 40 PDFs / 200+ pages is dominated by pdf.js, which the app already pays today.

- **Web Worker:** extraction and parsing run off the main thread so the screen never freezes. One file at a time, progress shown, cancellable.
- **Cheap detection first:** after page 1 (or 2), check for a plausible table header. If none, stop. A letter or a 100-page terms booklet costs one page, not all of them.
- **Budgets:** per file a page cap and a time cap, with a clear "skipped: too large" message, so one odd PDF cannot hang the app.
- **Cache:** reuse the existing fingerprint + parser-version cache so each file is read once. (The generic reader gets its own version number so improving it can re-read only what it handled.)
- **Memory:** release each page after reading (`page.cleanup()`), destroy the document, never keep the PDF bytes.
- **Algorithms:** replace the per-item list scan in row grouping with sort-and-sweep; skip the extra reading passes when the first already verifies and nothing is ambiguous.
- **Known gap to add:** trailing-minus amounts (`12.34-`).

## 5. User experience: deliberately OPEN

Not decided. The screens are out of scope for now, and the owner does not want a confirmation for every file (tedious). Principles to design against later:

- **No per-file confirmation as the normal path.** Friction should scale with risk, not with volume.
- **Trust comes from proof, not from asking.** Only a statement that proves itself against its own balances/totals is eligible to be added at all; everything else is never added.
- **Quiet by default, loud only for exceptions.** One summary after a batch ("38 added, 2 need a look") instead of a prompt per file.
- **Easy to undo rather than hard to confirm.** Anything read this way is tagged as such and can be removed in one tap (the app already has "remove a file" and an ignore list).
- **Ideas to evaluate when we get there:** a single batch confirmation only the first time a new bank is seen; auto-add once a bank has proven itself on N statements; a small "read automatically" label on those statements; a review list only for `unverified` results.

Decision deferred until the reader's measured reliability (section 6) is known: the better the proof, the less asking is needed.

## 5b. Payslips (to discuss separately)

Payslips have a different shape (labelled pay and deduction lines, not a dated table) but are also provable: earnings add to gross, deductions add to the total, gross minus deductions equals net, year-to-date figures move consistently month to month. The existing ePay reader stays as is. The generic payslip reader is separate (`readers/income.js`, with its own tests) and is not mixed into the statement reader.

## 5c. Upload routing and the CSV reader (agreed direction, not built)

**Routing.** One upload box. The file type is detected from the file itself (the `%PDF` header or the content, not just the extension), then sent to the right reader:

| file | route |
|---|---|
| PDF with a text layer | existing readers first, then the generic PDF reader (verified results only) |
| PDF with no text (scan) | rejected, labelled "scanned, not supported" |
| CSV | CSV reader (below) |

**A PDF that cannot be read correctly is not kept.** If no reader can produce a verified result, nothing is stored, the file is not retained, and the user sees one plain message: this statement could not be read reliably, so please download the CSV version of the same statement from your bank and upload that. A scan gets the same message, saying it is a scan. No partial results are added.

**CSV reader (own plug-in file, same contract `{id, detect, read}`).**
- Detect: delimiter (comma, semicolon, tab), quoting and encoding (UTF-8 with or without BOM), then a header row of known words (Date, Description/Details/Memo/Reference, Amount, Paid in/out, Money in/out, Debit/Credit, Balance).
- Columns map by header words, never by position, so a bank adding a column does not break it.
- Dates are day-first only; an ambiguous or month-first file is refused, as in the PDF reader. Amounts use whole pence and accept the usual forms (brackets, trailing minus, CR/DR, thousands commas, a leading £).
- Proof: the same running-balance chain when a Balance column exists; otherwise the file is "unverified" and shows a warning rather than being silently trusted. Where a CSV has no balance column, check for an exact duplicate export (same file read twice).
- Never trust a quoted or formula-like cell (`=`, `+`, `@`): treat everything as text.
- Needs real exports to test. Collecting a few from each major bank comes first; fixtures are then generated from the same shapes.

**Status:** built. `readers/csv.js` with a ~220-file synthetic test suite (`tests/csv/README.md`), also run over four real export files (current account and card).

## 6. Testing plan (the gate before any wiring)

1. **Real layouts:** keep growing `SampleStatementsForTesting` with real UK banks and cards (older and newer layouts). Report: verified / failed per file, and identical-to-existing-reader for the four we have readers for (currently 4 of 4 identical).
2. **Generated known-answer statements:** hundreds of invented PDFs with randomised column order, date style, sign convention, wrapped and two-line rows, repeated headers, side panels, split-word PDFs, multi-page tables. Report hit rate by layout feature.
3. **False-verified tests:** mutate generated statements (change a digit, drop a row, swap a sign, add a stray line, duplicate a row) and assert none ever reports `verified`. Target: 0 in several thousand.
4. **Regression:** existing tests and the full snapshot comparison must be unchanged with the feature present and off.
5. **Performance:** benchmark in the harness (pages/second, peak heap) plus a 300-page stress fixture with a time budget as a pass/fail test.

**Gate to even prototype wiring:** zero false-verified in the mutation suite, existing-reader results identical on every real sample, and the real-layout hit rate reviewed by the owner.

## 6b. Rollout (each step is separate and reversible)

1. Experiment branch only: harness and tests, no app changes. **Done.**
2. Hardening: more real samples. **Done for the samples available**; items 3 and 5 above are still open.
3. Wired in on the branch as a verified-only fallback with an off switch (default on, decided with the owner). **Done.**
4. Owner decides whether to merge: merged for v4.1.

## 7. Open questions

- Which banks and cards matter most to you after the ones already supported? (Drives which real samples to collect first.)
- How little confirmation is acceptable? (see section 5; for example: none once a bank has proven itself, a summary only.)
- Should a generic-read bank become a named, saved reader once it has verified a few times, or always stay "generic"?
