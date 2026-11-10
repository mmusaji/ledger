# Household Ledger

A private app for your phone that reads your own statements (PDF or CSV) and turns them into a dashboard and searchable reports. It was built as a personal tool and is shared with a few people by invitation. Please don't pass the link on without asking.

**Your statements never leave your device.** There is no server, no account, no analytics and no AI, and no sign-in to Google or anyone else. The app reads each file on your phone, keeps only the transactions it finds (encrypted with a passcode you choose), and throws the file away.

> **Please read before you rely on it.** This is a hobby project shared as-is, with no support and no warranty. It was built around one household's banks and cards, so other layouts may be rough, and the payslip, ISA and pension readers have so far been tried only on invented examples. It only reads the statements listed below, and it has only been tested in Chrome on Android (not on iPhones or tablets). Every statement carries a mark: ✓ when its own balances or totals prove every line, ○ when a CSV has nothing to check it against, ⚠ when a PDF's totals don't match. Tap any mark to see what it means. Always treat the numbers as a helpful summary, not as your official records.

## What it reads

| Statement | Notes |
|---|---|
| **Santander** current / joint account statements | UK format. Every line is checked against the running balance printed on the statement. |
| **Monzo** current account statements (PDF) | Checked against the running balance and the deposit and outgoing totals printed on the statement. Pots are shown only in that account's own view. The CSV export also works (below), but has no balance to check it against, so the PDF is preferred. |
| **Amex** card statements | Split by cardholder. |
| **Tesco Bank / Clubcard** credit card statements | |
| **Payslips** | The ePay layout, and other UK payslips **when gross − deductions = net** adds up exactly. Lines a payslip doesn't have (basic, ESPP, RSU) are simply not shown. |
| **ISA, savings and pension statements** (any provider) | Kept only when opening value + paid in − paid out + growth − charges = closing value. You name each account once (for example "Vanguard · Junior ISA") and Savings shows one section per account. |
| **Moneyfarm** ISA quarterly statements | |
| **Aviva** workplace pension annual statements | |
| **CSV exports** from UK banks and cards | Any layout with dates, descriptions and amounts. Checked ✓ when it has a balance column; otherwise read but not checked ○. A CSV doesn't say which account it is, so you name it once (or say it's the same account as your PDFs) and the app remembers that layout. |
| **PDFs from other banks** | Read only when the statement's own running balance or printed totals prove every line (tested with Barclays, HSBC, first direct, NatWest and Revolut). Anything it can't prove is refused. Named like a CSV. Can be switched off in **Settings**. |

The app works out what a file is from what's inside it, not from its name. A file it can't read is **not kept**: the import result says why and suggests what to try instead (usually the CSV of the same statement), so you can simply add it again after a fix. Files already read are recognised and skipped. **If your bank, card or payslip isn't covered, the app won't read it yet.** Try **Explore with sample data** to see what it does.

## What you get

- **Dashboard** by pay month (start day adjustable in **Settings**, default 6th; a pay month the statements only partly cover is left out and flagged): income, spending, left over, one-off payments (with a switch to hide them), who spent what, spending by category, bank balance, direct debits and top payees.
- **Household and personal accounts:** every current account you add is either **Household** (joint or shared) or **Personal**. All household accounts are merged into a single household view, and money moving between them is not counted as income or spending. A personal account is kept apart from the household figures. Once you have one, a switch appears at the top of the Dashboard, Reports, Pay and Documents screens. The first account you add is always the household's.
- **Reports:** search and filter by text, account or card, dates, in or out, category, payment type and amount, with totals. Save your favourite reports.
- **Pay:** each payslip from gross to net, pension, tax-year totals.
- **Savings:** each ISA, savings and pension account on its own (value, paid in, growth, charges, ISA allowance left), and savings transfers.
- **Documents:** every statement and payslip you have added, in and out. A grid showing which months are present or missing, card repayments matched to the card statements they paid (so nothing is counted twice), and every statement grouped by account in lists that open and close (for example `Amex (14)`).
- **Imports you can trust:** each import is saved all at once with a result sheet and an **Undo**. Where files overlap (a CSV over months you already have as PDFs, or two downloads covering the same days), each transaction is counted once; a PDF that adds up wins for its dates. A PDF whose totals don't match can be reviewed: see what it does to the figures, then keep it or leave it out. The Dashboard and Reports say when such a statement is counted.

## Try it

1. On your phone, open the link you were sent in **Chrome**, then tap ⋮ → **Install app** (or **Add to Home screen**).
2. Tap **Explore with sample data** to look around with invented numbers. To open the demo any time without touching your own data, add `?demo` to the address.
3. When you're ready, go to **Documents → Add statements** and choose your statements (PDFs and CSVs can be mixed). In the file chooser you can pick from any folder on your phone, or from Google Drive (tap ☰). Use **⋮ → Select all** inside a folder. Android can't select a whole folder, only the files in it.
   - On Android you can also select statements in the **Files** or **Google Drive** app, then **Share → Ledger**.
4. When the first files are read, choose a **passcode**. It encrypts what's saved on your phone. If you forget it, you can erase the saved data and add the statements again. Your statements are untouched wherever you keep them.

Each month, just add the new statements. Choosing the whole folder is fine, because statements already read are recognised and skipped.

**Where it's been tested:** only in **Chrome**, mainly on an **Android phone**. It has **not** been tested on iPhones, iPads or tablets, or in other browsers such as Safari, Firefox or Edge. It may work there, but don't assume it does. The Share route is Android-only.

## Privacy and security

| | |
|---|---|
| Where it runs | On your device, in the browser. GitHub only hosts the app's files. |
| What it can see | Only the files you choose or share. |
| What is saved | The transactions read from your statements, **encrypted (AES-256)** and locked with your passcode, plus your category rules and corrections. Saved on your device only. |
| Statement files | Read in memory and discarded. Files sent with Share are held in the browser for a few seconds until read, then deleted. |
| Auto-lock | After 5 minutes in the background. |
| Devices | Each device keeps its own copy. Nothing syncs between devices. |
| Updates | The app checks for a new version each time you open it. Updates come from this repository, so you are trusting its owner. If you'd rather not, host your own copy (below). |

Sensible precautions: use a phone lock screen, choose a passcode, and don't install the app on a shared or public device.

## Your own categories

The app comes with generic rules (supermarkets, utilities, fuel and so on). To categorise your own payees, open any transaction and choose a category, leaving **"use this for every payment to …"** ticked. Rules can also be added, copied and imported in **Settings**. An imported rules file looks like this:

```json
[
  { "text": "ACME CLEANERS", "category": "Household services", "dir": "out" },
  { "text": "BIRTHDAY MONEY", "category": "Other income" }
]
```

`dir` is optional (`"in"` or `"out"`). Your rules stay on your device.

## Host your own copy (optional)

You don't need GitHub to use the app. If you want your own copy, with updates only when you choose:

1. Fork this repository (or download it and create your own public repository), then in **Settings → Pages** choose **Deploy from a branch → main / (root)**.
2. After a minute it's live at `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`. Install it from there.

## How the code is organised

Plain JavaScript, no build step and no dependencies other than the bundled PDF.js. Open `index.html` through any static web server to run it.

| File | What it does |
|---|---|
| `index.html`, `app.css` | The page and its styles |
| `parser.js`, `readers.js`, `readers/monzo.js` | Read the text out of each kind of statement and check the totals |
| `readers/csv.js`, `readers/smart.js`, `readers/income.js` | The generic CSV reader, the generic bank-PDF reader (last resort, proven results only), and the payslip / ISA / savings / pension reader |
| `rules.js` | Spending categories and the built-in categorisation rules |
| `js/main.js` | Start-up |
| `js/state.js`, `js/model.js`, `js/period.js` | The shared state, transactions and categories, pay months |
| `js/vault.js` | Encrypted saved data, passcode, locking |
| `js/ingest.js`, `js/pipeline.js`, `js/importview.js`, `js/demo.js` | Adding statements (file chooser and Share): routing, reading, the import result and Undo; sample data |
| `js/book.js`, `js/accountsheet.js` | Named accounts for CSVs, remembered layouts, overlaps between files; the "Which account is this?" sheet |
| `js/stmtsheet.js`, `js/notices.js` | A statement's own sheet (marks, review of a PDF that doesn't add up), and the notice on the Dashboard and Reports |
| `js/home.js`, `reports.js`, `pay.js`, `savings.js`, `statements.js`, `settings.js`, `txn.js` | One file per screen |
| `js/ui.js`, `charts.js`, `util.js`, `deps.js`, `events.js` | Shared screen plumbing, helpers and click handling |
| `sw.js` | Lets the app open offline and pick up updates |

### Tests

Run from the repository folder with Node (no install needed for the first four):

```
node tests/pipeline.test.js        # import routing, outcomes, result sheet
node tests/book.test.js            # accounts, overlaps, how CSVs reach the figures
node tests/monzo.test.js           # Monzo PDF reader
node tests/income.test.js          # payslip, ISA, savings and pension reader
node tests/version.test.js         # the version number is the same in the app, sw.js and CHANGELOG
node tools/csv-eval.js --regen     # CSV reader against ~220 generated files with known answers
node tools/smart-eval.js tests/smart/fixtures --expect tests/smart/fixtures/expected.json   # generic PDF reader
```

All test data is invented. See `tests/csv/README.md` and `tools/README-smart-eval.md` for running the readers over your own files (nothing is copied or uploaded).

## Licence

Free for personal and other **non-commercial** use, including trying it, studying it and changing it for yourself, under the [PolyForm Noncommercial License 1.0.0](LICENSE). Commercial use, such as offering it to customers or building it into a paid product, isn't allowed without the owner's written permission. PDF.js, used to read PDFs, is separately licensed. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
