# Household Ledger

A private app for your phone that reads your own statement PDFs and turns them into a dashboard and searchable reports. It was built as a personal tool and is shared with a few people by invitation. Please don't pass the link on without asking.

**Your statements never leave your device.** There is no server, no account, no analytics and no AI, and no sign-in to Google or anyone else. The app reads each PDF on your phone, keeps only the transactions it finds (encrypted with a passcode you choose), and throws the PDF away.

> **Please read before you rely on it.** This is a hobby project shared as-is, with no support and no warranty. It only understands the statement layouts listed below, and it has only been tested in Chrome on Android (not on iPhones or tablets). When it can't make a statement add up, it shows a ⚠ rather than guessing, but always treat the numbers as a helpful summary, not as your official records.

## What it reads

| Statement | Notes |
|---|---|
| **Santander** current / joint account statements | UK format. Every line is checked against the running balance printed on the statement. |
| **Amex** card statements | Split by cardholder. |
| **Tesco Bank / Clubcard** credit card statements | |
| **Payslips** | ePay layout only. |
| **Moneyfarm** ISA quarterly statements | |
| **Aviva** workplace pension annual statements | |

Anything else is skipped with a message ("Not a statement this app reads"), and nothing is added. The app works out what a PDF is from what's inside it, not from the file name, and ignores duplicates. **If your bank, card or payslip isn't in the list, the app won't read it yet.** Try **Explore with sample data** to see what it does.

## What you get

- **Dashboard** by pay month (start day adjustable in **Settings**, default 6th): income, spending, left over, one-off payments (with a switch to hide them), who spent what, spending by category, bank balance, direct debits and top payees.
- **Reports:** search and filter by text, account or card, dates, in or out, category, payment type and amount, with totals. Save your favourite reports.
- **Pay:** each payslip from gross to net, pension, tax-year totals.
- **Savings:** ISA value and allowance, pension value, savings transfers.
- **Statements:** a grid showing which months are present or missing, and card repayments matched to the card statements they paid (so nothing is counted twice).

## Try it

1. On your phone, open the link you were sent in **Chrome**, then tap ⋮ → **Install app** (or **Add to Home screen**).
2. Tap **Explore with sample data** to look around with invented numbers. To open the demo any time without touching your own data, add `?demo` to the address.
3. When you're ready, go to **Statements → Add PDFs** and choose your statements. In the file chooser you can pick from any folder on your phone, or from Google Drive (tap ☰). Use **⋮ → Select all** inside a folder. Android can't select a whole folder, only the files in it.
   - On Android you can also select PDFs in the **Files** or **Google Drive** app, then **Share → Ledger**.
4. When the first files are read, choose a **passcode**. It encrypts what's saved on your phone. If you forget it, you can erase the saved data and add the PDFs again. Your statements are untouched wherever you keep them.

Each month, just add the new statements. Choosing the whole folder is fine, because statements already read are recognised and skipped.

**Where it's been tested:** only in **Chrome**, mainly on an **Android phone**. It has **not** been tested on iPhones, iPads or tablets, or in other browsers such as Safari, Firefox or Edge. It may work there, but don't assume it does. The Share route is Android-only.

## Privacy and security

| | |
|---|---|
| Where it runs | On your device, in the browser. GitHub only hosts the app's files. |
| What it can see | Only the PDFs you choose or share. |
| What is saved | The transactions read from your statements, **encrypted (AES-256)** and locked with your passcode, plus your category rules and corrections. Saved on your device only. |
| PDFs | Read in memory and discarded. Files sent with Share are held in the browser for a few seconds until read, then deleted. |
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

## Licence

Free for personal and other **non-commercial** use, including trying it, studying it and changing it for yourself, under the [PolyForm Noncommercial License 1.0.0](LICENSE). Commercial use, such as offering it to customers or building it into a paid product, isn't allowed without the owner's written permission. PDF.js, used to read PDFs, is separately licensed. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
