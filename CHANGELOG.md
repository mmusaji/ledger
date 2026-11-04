# Changes

## v4.0 (branch `v4`, in progress)

**Accounts.** Every current account is now either **Household** or **Personal**.
- The first account added is the household's. Later ones are asked about when first seen.
- All household accounts are merged into one household view. Payments between them (a payment out of one that arrives in another within 3 days) are not counted as income or spending. The bank balance and overdrawn days use the combined balance. A pay month counts only when every household account has statements for it.
- A personal account is kept apart from the household figures. A switch at the top of the Dashboard, Reports, Pay and Statements screens chooses what is shown. Pots (Monzo) appear only in that account's own view.
- Roles can be changed in Settings → Accounts. At least one household account is required.

**Why.** Adding a second current account used to be ambiguous: was it part of the household or someone's own spending money? Household maths and personal detail are now kept apart, and a joint pair of accounts can be viewed as one.

**Monzo.** New reader for Monzo PDF statements, in its own file (`readers/monzo.js`) with tests. It checks every line against the running balance and the printed deposit and outgoing totals. It reads only the main account section and ignores the pot statements.

**Transfers to a personal account.** When an account becomes Personal, household-account payments that match its own-name deposits are offered as rules: money to it is Personal spending, money back is a Family contribution. Nothing is saved unless you accept. Also under Settings → Accounts → Find transfers.

**Compatibility.** Saved statements still open. The statement reader version went from 2 to 3 so that re-adding a statement records its account number. Until you re-add your older Santander statements they are treated as one account without a number.
