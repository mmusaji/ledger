# CSV reader tests (branch `smart-parser`)

Reader under test: `readers/csv.js` (not wired into the app). Harness: `tools/csv-eval.js`.

```
node tools/csv-eval.js --regen          # generate ~200 synthetic CSVs with known answers, run them, print only what is not a plain PASS
node tools/csv-eval.js --only tamper    # run a subset by name
node tools/csv-eval.js <folder-of-real-csvs>   # no expected.json: just reads each file and reports (counts only; --details adds rows)
node tests/csv/profile_pdfs.js <folder-of-pdfs>  # re-learn the anonymous shapes from real statements
```

All fixture content is invented. Only anonymous numbers (row counts, amount deciles 10-90%, share of money in) come from real PDFs (`profile.json`).
Generated files go to `tests/csv/fixtures/` (git-ignored; same seed = same files).

Outcomes that must stay at 0: FALSE-VERIFIED, WRONG-DATA, ACCEPTED-BAD, CRASH. REJECTED-VALID is the cost side (good files refused).

Known gaps (listed as `known`, not failures): files with no header row; an edit to the very first row of a balance-chained file (no earlier balance to check it against);
a card CSV with only spend and no hints (sign cannot be proven without a balance).

Limit: these tests are written by the same people who wrote the reader. Real bank exports are what really test it: drop them in a folder and run the third command.
