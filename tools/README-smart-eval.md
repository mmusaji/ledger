# Smart-parser experiment (branch `smart-parser`)

Question: can one generic reader, with no bank-specific code, read most UK statements — and can it *prove* it got them right?

`readers/smart.js` finds the transaction table from its header words and column positions, reads the rows, then checks
the arithmetic (running balances, opening/closing balance, printed totals in/out). Sign conventions (bank vs credit card)
are treated as hypotheses and the one that satisfies the statement's own arithmetic wins. Possible outcomes per PDF:

| result | meaning |
|---|---|
| **verified** | the figures add up against something printed on the statement |
| **unverified** | rows were read but the statement has nothing to prove them against (would be shown with a warning) |
| **failed** | the sums disagree, or no table was found (nothing would be added) |

It is **not wired into the app**. It only runs from this harness.

## Run it

```
node tools/smart-eval.js tests/smart/fixtures --expect tests/smart/fixtures/expected.json     # known-answer fixtures
node tools/smart-eval.js ~/Documents/statements                                               # your own PDFs, any folder
node tools/smart-eval.js ~/Documents/statements --json report.json                            # machine-readable report
node tools/smart-eval.js ~/Documents/statements --details                                     # adds the rows it read (shows payees)
```

Everything runs on your computer using the PDF reader already in `vendor/`. Files are only read; nothing is copied or uploaded.
Without `--details` the report shows counts and totals only.

For PDFs the app already reads (Santander, Amex, Tesco, Monzo…), the report also compares the generic reader's transactions
with the app's own reader, row for row (date + amount).

## Fixtures

`tests/smart/make_fixtures.py` (needs `pip install reportlab`) draws invented statements in common layouts: signed amount + balance,
paid out / paid in + balance, daily balances with printed totals, credit cards with `CR` suffixes or minus signs, year-less ordinal dates,
multi-page tables with repeated headers, plus two that must NOT verify (a tampered balance, a page with no table).
These are layouts, not copies of any bank's real statement.
