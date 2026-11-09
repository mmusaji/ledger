# To do (captured items, not scheduled)

Open items after v4.1 (the import flow, merged to `main` as 57307a6; the branch is deleted). Ordered by how much they would help, highest first.
To undo the whole v4.1 merge: `git revert -m 1 57307a6`, or reset `main` to the tag `pre-smart-parser`.

## Import
- **Fewer questions.** Each PDF from another bank asks which account it is, because it has no remembered layout. Suggest the account from the file (account name or last four digits on the statement), and let several files be named in one sheet.
- **Two cards with the same CSV layout** are attached to the first one silently (it can be changed by tapping the file). Warn, or use the card number / card member column to tell them apart.
- **Several cards in one CSV** (a card member column): split them into one account each.
- **A card CSV checked against its PDF.** A card CSV has no balance, so it is ○. Where a PDF of the same card covers the same dates and every row matches, it could be shown as corroborated.

## Figures
- **Home with CSV bank accounts.** The "regular payments" (direct debits and standing orders) panel still looks only at Santander PDFs, and a CSV Type column of "Direct Debit" or "DD" is not yet treated as a direct debit.
- **Months left out.** A pay month counts only when every household account has statements for it, so CSVs of different lengths can leave many months out. Offer a way to see or fix what is missing.
- **Pay and Savings** read only payslip, Moneyfarm and Aviva PDFs.
- **Coverage grid** shows PDF statement types only; CSV accounts appear in their own lists.

## Readers
- Santander Connect Plus (business) layout, if needed.
- Cross-statement continuity for PDFs (closing balance of one equals the opening of the next) beyond Santander.
- Statements still refused in the samples: Monzo PDF with 0 rows read, Bank of America, Nationwide, Starling, scanned PDFs (use their CSV).

## Housekeeping
- If a second build is ever hosted under the same address (for example a test copy), give its saved data its own names first: the database `ledger`, the `ledger.*` browser settings and the `ledger-inbox` cache are shared by everything on `mmusaji.github.io`.

## Before sharing with other people: personal details to remove
Done as one small commit when asked. Nothing here is real data, but it hints at one household.
- `js/accountsheet.js` (lines ~54 and ~59): the name examples "Amex · Fizza" and "Monzo · Mustafa" show in the app. Use neutral ones ("Amex · Sam").
- `tests/book.test.js`: "Amex · Fizza".
- `readers.js`, payslip comment: "Red Hat / ePay format" names an employer. Say "ePay layout".
- `js/pay.js` and `js/demo.js`: ESPP, RSU and car-allowance wording and fields are specific to one employer's payslip. Keep the features, but label them generically ("share purchase plan", "share awards") and hide them when the payslip has none.
- `rules.js`: the built-in rules name AVIVA, MONEYFARM, TRADING 212 and VANGUARD. These are public provider names and fine, but check no rule is tied to one person's payees.
- `README.md`: add one line that the app was built around one household's banks, so other layouts may be rough.
- Git history still holds the old wording; only a rewrite or a fresh repository would remove it. Decide whether that matters.
- Housekeeping: delete the remote branch (`git push origin --delete smart-parser`).

## Other income: payslips, savings, pensions (next priority)
Today only three layouts are read: one employer's ePay payslip, Moneyfarm ISA quarterlies and Aviva annual pension statements, by exact wording in `readers.js`. Design to follow in `docs/OTHER-INCOME-DESIGN.md`.
