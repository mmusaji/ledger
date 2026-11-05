# Smart parser: design (draft, experiment branch `smart-parser`)

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
- Import only `verified` results, and only after the user confirms a preview (section 5).
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

## 5. User experience (only if built)

After choosing files, anything the existing readers cannot read and the generic reader **proves** is shown as a preview:
"Read 66 transactions from natwest.pdf, 13 Dec 2023 to 12 Jan 2024, proven against your running balances. Add them?"
Nothing is saved until the user taps Add. Failed and unverified files are listed with the plain-language reason. No new settings screens beyond one on/off switch.

## 6. Testing plan (the gate before any wiring)

1. **Real layouts:** keep growing `SampleStatementsForTesting` with real UK banks and cards (older and newer layouts). Report: verified / failed per file, and identical-to-existing-reader for the four we have readers for (currently 4 of 4 identical).
2. **Generated known-answer statements:** hundreds of invented PDFs with randomised column order, date style, sign convention, wrapped and two-line rows, repeated headers, side panels, split-word PDFs, multi-page tables. Report hit rate by layout feature.
3. **False-verified tests:** mutate generated statements (change a digit, drop a row, swap a sign, add a stray line, duplicate a row) and assert none ever reports `verified`. Target: 0 in several thousand.
4. **Regression:** existing tests and the full snapshot comparison must be unchanged with the feature present and off.
5. **Performance:** benchmark in the harness (pages/second, peak heap) plus a 300-page stress fixture with a time budget as a pass/fail test.

**Gate to even prototype wiring:** zero false-verified in the mutation suite, existing-reader results identical on every real sample, and the real-layout hit rate reviewed by the owner.

## 6b. Rollout (each step is separate and reversible)

1. Experiment branch only (now): harness and tests, no app changes.
2. Hardening: items 2, 3, 5 above; more real samples.
3. Prototype behind the off-by-default switch, on a separate branch, preview-and-confirm only.
4. Owner decides whether to merge. Nothing happens to `main` before that.

## 7. Open questions

- Which banks and cards matter most to you after the ones already supported? (Drives which real samples to collect first.)
- Is a preview-and-confirm step acceptable for every generic-read file, or only the first from each bank?
- Should a generic-read bank become a named, saved reader once it has verified a few times, or always stay "generic"?
