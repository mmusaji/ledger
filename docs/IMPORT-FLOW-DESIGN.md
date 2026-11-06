# Import flow: PDFs and CSVs, accounts, duplicates (design, branch `smart-parser`)

Status: agreed direction, not built. Decisions made with the user on 2026-11-06 are marked **Decided**.
Rule for everything below: existing readers and the way the app works today are not changed unless a stage says so; each stage is one commit and can be rolled back.

## 1. The flow

1. **Add statements.** One button. The chooser accepts `.pdf` and `.csv`. Phones cannot pick a folder, only "select all" inside one (as today). The Share-sheet route (manifest + service worker) also accepts CSV.
2. **Choose files.** Any mix of PDFs and CSVs.
3. **Route by the file's own bytes** (`%PDF`, or text with delimiters); the extension is only a hint. A PDF renamed `.csv` is refused.
4. **Read (staged, nothing stored yet).**
   - PDF: the existing readers first, unchanged. Only if every existing reader says "not mine" does the generic PDF reader (`readers/smart.js`) try, and only a **verified** result is accepted (see section 5).
   - CSV: `readers/csv.js`.
5. **A file that cannot be read is not kept.** No entry is stored. The user sees one **result sheet** at the end of the batch ("Added 12 · already had 3 · couldn't read 2"), each unreadable file with a plain reason (scan, not a statement, unsupported layout, totals do not add up) and "Try the CSV of the same statement from your bank". A dismissible **Last import** card stays on the Statements screen until the next import. PDFs that read but have a total mismatch keep their warning, as today (existing behaviour).
6. **Name the account (new layouts only).** See section 3.
7. **Validate before storing.** See section 4.
8. **Commit the batch at once**, then offer **Undo last import**.
9. **Statements list is collapsed** (section 6).

## 2. What the user sees for CSV rows that could not be proven (Decided: a small, clear mark)

| Mark | Meaning | Words shown when tapped |
|---|---|---|
| ✓ | checked | "The totals add up against the statement" (PDF), or "The running balance adds up on every row" (CSV with a Balance column). |
| ○ | not checked | "This CSV has no balance column, so the totals cannot be checked. The amounts are shown exactly as your bank's file gives them." |
| ⚠ | problem | The existing warning text. |

A bank's CSV carries no printed totals, so ○ is normal for Monzo and card exports. It is information, not an error.

## 3. Naming accounts from CSVs (and unknown-bank PDFs)

A CSV carries no bank name. Resolution order:
1. **Known layout** (column set plus an account hint such as card digits or card member): attach silently to the account it was tied to before.
2. **New layout**: one question per new layout per batch, not per file. "Monzo-style current account, 731 rows, 1 Nov 2025 to 6 Nov 2026. Which account is this?" Choices: an existing account of the same kind, or a new account (name prefilled from the file name, Household or Personal through the existing role question). Card or current account is pre-filled from the reader (`accountType`) and editable.
3. **Several cards in one file** (`activity.csv` has two card members): one question naming each card.
4. The layout, the account hint and the chosen account are remembered, so later files go straight in.

Data model: a first-class **account list** (name, card or current, role, remembered layouts). The existing readers fill it automatically, so Santander, Amex, Tesco and Monzo keep working. CSV-only accounts use a generic statement type linked to their account.

## 4. Checks before anything is stored (Decided: overlaps must not be duplicated)

- **Same file**: same content hash is skipped (as today).
- **Same transactions**: match incoming rows to what the account already holds by date + amount (+ normalised description), **as a multiset** so two genuine identical purchases on one day are kept. Fully known: skipped. Partly known (for example a 13-month CSV over months already loaded from PDFs): only the new rows are added, and the result sheet says how many were new and how many were already there.
- **Source precedence**: a verified PDF wins over an unproven CSV for the same period.
- **Sanity**: no future dates, nothing before 2000, GBP only, an implausible span flagged.
- **Account type**: a card CSV cannot be attached to a current account (or the reverse) without a warning.
- **Continuity**: a CSV with a balance should start where the account's stored balance left off; a break is shown as a gap, not hidden.
- **All-or-nothing batch** with Undo.

## 5. Generic PDF reader (Decided: yes, as an improvement to the current PDF reader)

`readers/smart.js` becomes a fallback, behind its own stage and an off switch:
- runs only after every existing reader says "not mine";
- only a **verified** result is accepted (the PDF's own arithmetic proves it); unverified or failed means "could not read" and the file is not kept;
- month-first dates, dollars, placeholders and statements whose own summary does not add up are refused;
- an unknown bank goes through the same account-naming question as a CSV.
On the current samples this reads Barclays, HSBC, first direct, NatWest and Revolut PDFs that no existing reader supports. It must not change any result for a statement an existing reader handles (checked: 4 of 4 identical today).

## 6. Statements screen (Decided: minimise the list)

One collapsed row per account with the count and coverage, e.g. `Amex (14) ✓ Nov 25 → Oct 26`; opening a row lists its files. The coverage grid stays on top. The "Not used" list is replaced by the Last import card.

## 7. Testing

- A Node harness for the whole pipeline (stage, validate, commit, undo) using the synthetic fixtures and real samples kept outside the repo: duplicates, PDF + CSV for the same account, a 13-month CSV over loaded months, a failing PDF, a scan, naming and layout memory, Undo.
- Existing suites must stay green; PDF results for existing readers must not change.
- **Decided**: this stays on the `smart-parser` branch for now; testing live comes later.

## 8. Before it ever goes live (not needed for local testing)

The saved data lives in an IndexedDB database called `ledger`, browser storage and a `ledger-inbox` cache. Another build on the same site (`mmusaji.github.io`) would share them and could corrupt live data. Before any live test: namespace those names, give the test build its own app name, icon and cache names, and decide between a migration and re-adding statements.

## 9. Stages (one commit each)

1. File routing + staged import pipeline + result sheet + Last import card (existing PDF readers and the CSV reader). **Built.** See the notes below.
2. Account list + naming flow + layout memory. **Built.**
3. Overlap and duplicate checks, source precedence, continuity, Undo. **Built.**
4. Collapsed Statements screen.
5. Generic PDF reader as the verified-only fallback, with its off switch.
6. Pipeline test harness (grows with each stage).

### Stage 1 notes (built)
- `js/pipeline.js` (pure logic, tested in Node by `tests/pipeline.test.js`): files are routed by their bytes, so a CSV renamed `.pdf` is still a CSV. One outcome per file: added, known, ignored or failed. A failed file is never stored.
- `js/importview.js`: the result sheet shown after each import and the **Last import** card on the Statements screen (kept in the encrypted vault, dismissible). It lists names and reasons only, never transactions.
- CSVs that read are stored as statements of type `csv` and listed under **CSV statements, waiting for account setup**. They are **held out of every figure** until Stage 2 (account names) and Stage 3 (overlap checks) exist, so nothing can be double counted in the meantime.
- Marks on CSV rows: ✓ checked against the running balance, ○ read but nothing to check it against, ⚠ read with a problem. (○ replaced the half-circle in the design because that glyph renders as a sliver in some fonts.)
- PDFs: the existing readers are untouched. What changed is that a PDF they cannot read is no longer saved as a "Not used" row; it appears in the result sheet with the hint to try the CSV. A money statement that found no transactions and does not add up is treated as not read. A PDF read with a total that does not match keeps its existing ⚠.
- The "Not used" list on the Statements screen still shows files saved by earlier versions.
- Share-target: the manifest field is now `files` (accepts PDF and CSV); the service worker still accepts the old `pdfs` field. Installed copies of the app need to be reinstalled to pick up the new manifest.

### Stage 2 and 3 notes (built)
- **Account book** (`js/book.js`, saved in the encrypted vault): accounts you named, which account each CSV file belongs to, and which account each CSV *layout* (column names only) was given. A known layout is attached silently and shown in the result; a new one is asked about once per import. Cancelling the question cancels the whole import and nothing is saved. "Decide later" leaves those files waiting, out of the figures.
- A CSV can be named as a **new** account (card, or current account with Household/Personal) or as **the same account as one known from PDFs** (Santander, Monzo, Amex, Tesco). In the second case the two are combined.
- Named CSVs reach the figures: cards as card spend, current accounts as current accounts (a Monzo `Type` column of "Pot transfer" is treated as a pot move). A card's payments from the bank are not counted as spend again once the CSV covers the month they pay for; the account's "payments show as" words find them.
- **Overlaps** (worked out every time the picture is rebuilt, so nothing is deleted): a PDF that adds up is the whole statement for its dates and beats a CSV; a CSV proven by its balance beats one that is not; otherwise rows with the same date and amount are counted once (a multiset, so two identical coffees stay two). Rows inside an overlap that match nothing are kept and reported as "differ".
- **Continuity**: gaps of more than 3 days and balances that do not carry over between CSV files are listed on the Statements screen.
- **Import is all-or-nothing** and has **Undo** (files, accounts and layouts added by the last import).
- **Statements that read but do not add up** open a review sheet: the size of the difference, what keeping or leaving them out does to the figures, and Keep / Leave out / Remove. Until you decide they are counted (as before) and the Dashboard and Reports show a notice. The best fix is to add the CSV of the same statement.
- A tap on any mark opens "What the marks mean". Names of files that could not be read are never saved (only a count).


## Stage 4 and 5 (collapsible lists, generic PDF fallback)

**Stage 4.** Statement lists are grouped by account as collapsible sections titled "Name (n)". A section starts open only when something inside needs attention (a warning, a held file, a file waiting for an account); otherwise it starts closed. What the person opens or closes is remembered on the device.

**Stage 5.** A PDF that no bank-specific reader recognises is passed to the generic table reader as a last resort. It is accepted only when its own arithmetic proves every row (running balances or printed totals); anything less is refused exactly as before, and nothing is stored. A PDF accepted this way is treated like a CSV: it asks which account it belongs to, and is marked "PDF, other bank". Settings has an On/Off switch ("PDFs from other banks"), default On.

**Browser-only bug found while checking.** The generic reader had two Node-only debug lines (`process.env`). In a browser they threw, the error was swallowed, and every such PDF was refused, although Node tests passed. Fixed with a guarded `ENV`, and a test now fails if the file touches `process` directly. Real samples in a browser: barclays, hsbc, natwest, revolut and first-direct are read and proven; Tesco uses its own reader; monzo.pdf, bank-of-america, nationwide, starling and the scanned Santander are still refused.
