# To do (captured items, not scheduled)

Open items after v4.1 (the import flow from the `smart-parser` branch). Ordered by how much they would help, highest first.

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
