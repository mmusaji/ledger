# CSV reader tests

Reader under test: `readers/csv.js` (used by the app's import, `js/pipeline.js`). Harness: `tools/csv-eval.js`.

```
node tools/csv-eval.js --regen          # generate ~200 synthetic CSVs with known answers, run them, print only what is not a plain PASS
node tools/csv-eval.js --only tamper    # run a subset by name
node tools/csv-eval.js <folder-of-real-csvs>   # no expected.json: just reads each file and reports (counts only; --details adds rows)
node tests/csv/profile_pdfs.js <folder-of-pdfs>  # re-learn the anonymous shapes from real statements
```

All fixture content is invented. Only anonymous numbers (row counts, amount deciles 10-90%, share of money in) come from real PDFs (`profile.json`).
Generated files go to `tests/csv/fixtures/` (git-ignored; same seed = same files).

Outcomes that must stay at 0: FALSE-VERIFIED, WRONG-DATA, ACCEPTED-BAD, CRASH. REJECTED-VALID is the cost side (good files refused).

Known gaps (listed as `known`, not failures): an edit to the very first row of a balance-chained file (no earlier balance to check it against);
a card CSV with only spend and no hints (sign cannot be proven without a balance).

Limit: these tests are written by the same people who wrote the reader. Real bank exports are what really test it: drop them in a folder and run the third command.

## Account type (card or current account)
The reader reports `accountType`: `card`, `current` or `unknown`, scored from header words (Card Member, Merchant City, Sort Code, Paid in...), description wording (payment received vs direct debit / standing order), and the sign convention that fitted. The harness checks it against the fixtures' known type; `unsure` (reader said unknown) is counted separately from `WRONG`.
A transaction-only card CSV cannot be proven by arithmetic (no balance), so it is `unverified`. It can be corroborated against a verified PDF statement of the same card (same dates and amounts).

## Columns found from contents
If no header names are recognised (or there is no header row), the reader finds the date, text and money columns from what is in them. Ambiguous cases (for example unlabelled money-in/money-out columns with no balance) are refused rather than guessed. A running balance must still prove the result.
