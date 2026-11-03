# Household Ledger: setup guide

This is a private phone app that reads your statements from Google Drive and turns them into dashboards and reports. It reads:

- **Santander** joint current account statements
- **Amex** statements, split by cardholder (you and Fizza)
- **Tesco Clubcard** credit card statements
- **Payslips** (Red Hat / ePay format)
- **Moneyfarm** ISA quarterly statements
- **Aviva** workplace pension annual statements

It works out what each PDF is from what's inside it, not from the file name, and ignores duplicates and anything else in the folders. Every reader checks its own totals against the statement, so a misread shows as ⚠ rather than wrong numbers.

The screens:

- a **dashboard** by pay month (6th to 5th): income, spending across bank and cards, left over, one-offs (with a switch to hide them), who spent what, spending by category, bank balance, direct debits and top payees
- a **Pay** tab: each payslip from gross to net, pension (you + employer), tax-year totals, and a check that net pay landed in the bank
- a **Savings** tab: Moneyfarm ISA value and allowance left, pension value and projection, and savings transfers from the joint account
- a **Statements** tab: a coverage grid showing what's missing, plus card repayments matched to the card statements they paid
- a **Reports** screen: search and filter by text, account or card, date range, money in or out, category, payment type and amount, with totals by account, pay month and payee

## How it stays private

| | |
|---|---|
| Where it runs | On your phone, in the browser or installed to your home screen. There is no server. |
| What it can see in Drive | Only the folders and files you pick. It asks Google for the `drive.file` permission, and Google itself blocks access to everything else. |
| What happens to statements | Each PDF is opened from Drive into the phone's memory, read, and thrown away. The PDFs are never saved. |
| What is saved on the phone | The transactions read from your statements, **encrypted (AES-256)** and locked with a passcode you choose. The app also saves your Google settings (below), the folders you picked, your category rules, saved reports, and category corrections (stored as one-way hashes). |
| Speed | The first sync reads every statement. After that, each sync downloads only statements that are new or changed, and the app opens straight away without signing in to Google. |
| Auto-lock | With a passcode, the app locks itself after 5 minutes in the background. |
| Who else is involved | Nobody. There is no analytics and no AI. Every network call goes to Google. |
| Checking the numbers | Every transaction is matched to the running balance printed on the statement. Each statement's money-in, money-out and closing-balance totals are checked. Any mismatch shows a ⚠ on the Statements tab. |

---

## One-off setup (about 15 minutes, best done on a computer)

### 1. Create your own Google Cloud project (free)

1. Go to **console.cloud.google.com** and sign in with the Google account that owns the Drive folders.
2. Use the project selector at the top: **New project**, name it `Household Ledger`, then **Create**.
3. Go to **APIs & Services → Library**. Search for and **Enable** both:
   - **Google Drive API**
   - **Google Picker API**
4. Go to **APIs & Services → OAuth consent screen**, shown as *Google Auth Platform* in newer consoles, and click **Get started**.
   - App name: `Household Ledger`. Support email: your Gmail.
   - Audience: **External**.
   - Contact email: your Gmail. Agree to the terms, then **Create**.
   - Under **Audience → Test users**, add your own Gmail. Leave the app in **Testing** mode. It never needs publishing.
   - Under **Data access → Add or remove scopes**, tick `.../auth/drive.file` and **Save**.
5. Go to **Clients**, or **Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Authorised JavaScript origins: `https://YOUR-GITHUB-USERNAME.github.io`
   - **Create**, then copy the **Client ID**.
6. Go to **Credentials → Create credentials → API key**, then open it and add these restrictions:
   - Application restrictions: **Websites**, with `https://YOUR-GITHUB-USERNAME.github.io/*`
   - API restrictions: **Restrict key → Google Picker API**
   - Copy the **key**.
7. Go to **IAM & Admin → Settings**, or the project dashboard, and copy the **Project number**. This is the 12-digit number, not the project ID.

### 2. Put the app on GitHub Pages (free)

1. On **github.com**, create a **New repository** called `ledger`. Make it **Public**, which free Pages requires.
   The code contains nothing personal. Your rules file stays on your phone.
2. Click **Add file → Upload files** and upload everything in this folder except `my-rules.json`:
   `index.html`, `app.js`, `app.css`, `parser.js`, `rules.js`, `sw.js`, `manifest.webmanifest`, the icons, and the `vendor` folder.
3. Go to **Settings → Pages**. Under Source, choose **Deploy from a branch**, set it to **main / (root)**, and **Save**.
4. After a minute your app is live at `https://YOUR-GITHUB-USERNAME.github.io/ledger/`.

### 3. Set up the phone

1. Open the link on your phone.
   - **Android (Chrome):** menu ⋮ → **Install app** (or **Add to Home screen**).
   - **iPhone (Safari):** Share → **Add to Home Screen**.
2. Open **Settings** in the app. Paste the **Client ID**, **API key** and **Project number**, then **Save**.
3. Open **Statements** and tap **Add from Google Drive**. Sign in, then choose your folders: **Joint Bank Statements**, **CC Statements**, **Payslips** and the **Moneyfarm** folder (which also holds the pension statement). You can select several at once.
   If the app later reports that the folder looks empty, open the picker again, go into the folder, and select the statement PDFs themselves. You can select them all at once.
4. Tap **Sync statements**. When it finishes, choose a passcode. This locks the saved transactions on the phone.
5. Go to **Settings → Your categorisation rules → Import or copy rules**, choose `my-rules.json`, and tap **Import**.
   This loads the categories we agreed for your payees: carers, Faiz Anjuman, the cleaner, holiday payments and so on.
   Keep that file off GitHub.

You can tap **Explore with sample data** at any time to try the app with invented numbers.

---

## Monthly use

- Upload the new statement to the same Drive folder as usual.
- Open the app, unlock it, and tap **Sync now**. Only the new statement is downloaded. If you picked individual files rather than the folder, tap **Add from Google Drive** and select the new one first.
- If a category is wrong, tap the transaction, choose the right category, and leave **"use this for every payment to …"** ticked so it sticks.

## Good to know

- **Sign-in:** viewing your data needs only your passcode. Google asks you to confirm only when you sync. This is deliberate. No long-lived Google login is stored.
- **iPhone:** if sign-in misbehaves when the app is opened from the home screen, open the same link in Safari instead. This is an Apple limitation with pop-ups in home-screen apps.
- **Settings → Saved data** lets you lock the app now, change or remove the passcode, or erase the saved transactions. Erasing keeps your settings and rules, and the next sync reads everything again. **Forget everything** removes it all.
- **Forgot your passcode?** Tap *Forgot it? Erase saved data* on the lock screen, then sync again. Nothing is lost, because the statements are still in Drive.
- **No double counting.** Card purchases count as spending. The joint account's card repayment is matched to the card statement it paid, so it isn't counted again. If that card statement isn't in Drive yet, the repayment counts as spending until it is.
- **Scanned PDFs can't be read.** Your 6 Feb–5 Mar 2026 Santander statement is a scanned image. Download that one again from Santander online banking and replace it in the folder.
- **Pension value** comes from the annual statement. Between statements, the Savings tab adds up what your payslips show you've paid in since.
- The mortgage annual statement isn't read in this version.
