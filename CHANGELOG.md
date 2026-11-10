# Changes

## Unreleased
- The **Statements** tab is now **Documents**: it holds everything you add (bank and card statements, payslips, ISA and pension statements), money in and out. Screen text that still said "Pick statements" now says "Add statements".

## v4.1 (from branch `smart-parser`)

**CSV statements.** Bank and card CSV exports can be added alongside PDFs; the app tells them apart by what is inside the file. A CSV with a balance column is checked line by line (✓); one without is read but not checked (○). A CSV does not say which account it is from, so the first time a layout is seen the app asks once ("Which account is this?": a new card or current account, or the same account as your PDFs) and remembers it.

**PDFs from other banks.** A PDF that no bank reader knows is read by a generic reader, and kept only when the statement's own running balance or printed totals prove every line. Tested on Barclays, HSBC, first direct, NatWest and Revolut statements. Can be switched off in Settings.

**Imports.** Everything in one go is saved together, with a result sheet and an **Undo**. A file that cannot be read is no longer saved: the result says why (a scan, not a statement, figures that don't add up) and what to try instead, so adding it again after a fix just works. Only a count of such files is kept, never their names.

**Overlaps.** Files covering the same days for one account are counted once: a PDF that adds up wins for its dates, a checked file beats an unchecked one, otherwise the same date and amount count once (two identical coffees on one day stay two). Rows that differ are kept and reported. Gaps and balances that don't carry over between CSVs are listed.

**Statements that don't add up.** Tap one to see the difference, what it does to your figures, and keep it or leave it out. Until you decide, it is counted (as before) and the Dashboard and Reports show a notice.

**Statements screen.** Lists are grouped by account and open or close (for example `Amex (14)`), remembering what you opened. Tap any mark for what it means.

**Compatibility.** Saved data from v4.0 opens unchanged (the reader version is still 3). Reinstall the app from the home screen if you want Share → Ledger to offer CSV files. Card repayments from the bank to a CSV-only card are recognised from the words you give for how the bank shows them.

## v4.0

**Accounts.** Every current account is now either **Household** or **Personal**.
- The first account added is the household's. Later ones are asked about when first seen.
- All household accounts are merged into one household view. Payments between them (a payment out of one that arrives in another within 3 days) are not counted as income or spending. The bank balance and overdrawn days use the combined balance. A pay month counts only when every household account has statements for it.
- A personal account is kept apart from the household figures. A switch at the top of the Dashboard, Reports, Pay and Statements screens chooses what is shown. Pots (Monzo) appear only in that account's own view.
- Roles can be changed in Settings → Accounts. At least one household account is required.

**Why.** Adding a second current account used to be ambiguous: was it part of the household or someone's own spending money? Household maths and personal detail are now kept apart, and a joint pair of accounts can be viewed as one.

**Monzo.** New reader for Monzo PDF statements, in its own file (`readers/monzo.js`) with tests. It checks every line against the running balance and the printed deposit and outgoing totals. It reads only the main account section and ignores the pot statements.

**Transfers to a personal account.** When an account becomes Personal, household-account payments that match its own-name deposits are offered as rules: money to it is Personal spending, money back is a Family contribution. Nothing is saved unless you accept. Also under Settings → Accounts → Find transfers.

**Compatibility.** Saved statements still open. The statement reader version went from 2 to 3 so that re-adding a statement records its account number. Until you re-add your older Santander statements they are treated as one account without a number.
