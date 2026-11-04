# Pocket Ledger — personal finance MVP

An offline-first React Native + Expo starter. All data is fictional until you choose to add your own. Currency defaults to AUD.

## What works

- Create/edit/delete bank, savings and cash accounts (delete blocked when referenced).
- Enter/edit/delete expenses, income and transfers.
- Balances derive from opening balances + transactions, with amounts stored as integer cents.
- Weekly/monthly spending totals; six-period spending graph; category breakdown and summary.
- One-off and recurring planned expenses, with a "Record paid" action that records a real transaction and advances the due date.
- Persists locally via `@react-native-async-storage/async-storage`.
- Demo data or empty start; reset with explicit confirmation.

## Start on your iPad (fastest proof of concept)

1. Open https://snack.expo.dev in Safari.
2. Replace the contents of `App.js` with this project's `App.js`.
3. Add the dependency `@react-native-async-storage/async-storage` in Snack's Dependencies panel if Snack does not automatically include it.
4. Use the web preview (browser behavior may vary) or open the Snack in Expo Go on your iPad/iPhone. Snack is a preview environment, not production hosting.
5. Select **Explore with fictional demo data** to test the screens. Select **Start with empty accounts** to track your own data later.

## Standard project / Codex workflow

1. Create a new GitHub repository; upload these four files (`App.js`, `app.json`, `package.json`, `.gitignore`; plus this README).
2. Open https://chatgpt.com/codex and connect that repository. Ask Codex to install dependencies, check package compatibility, run static checks, and establish an Expo preview.
3. On an environment with Node.js: `npm install && npx expo install --fix && npx expo start --tunnel`.
4. Test in Expo Go or request an EAS cloud development build if needed.

Expo SDK 57 is selected as an iPad Expo Go-friendly baseline as of November 2026. Expo SDK 58 is current, but Expo Go rollout timing has been changing. Ask Codex to verify the Expo Go version available on your device before upgrading.

## Important limitations

- **Prototype, not production-grade for sensitive finances.** AsyncStorage is not independently encrypted. Device-level iOS protection exists, but there is no additional application encryption or Face ID gate.
- **No backup or sync.** Deleting the app or clearing its data can permanently remove records. Avoid entering financial information you cannot afford to lose.
- No CDR/bank integration, CSV import/export, multi-currency, liabilities/credit-card debt accounting, attachments, shared use, or advanced budgets.
- Credit-card liabilities are not supported yet. Do not use the displayed total as net worth if you have debts; dedicated liabilities support belongs in a future version.
- Future payments are projections only. They do not change balances until the payment is explicitly recorded. Avoid also manually recording the same payment when using **Record paid**.
- The UI uses a text field for dates (YYYY-MM-DD) rather than a native date picker.
- Does not support negative opening balances in v1.
- Not fully tested on physical hardware in this environment. Test all screens in Expo Go before depending on the app.

## Suggested Codex next tasks

1. Confirm build and Expo Go compatibility; fix any runtime issues.
2. Extract money/date calculations into `src/lib/finance.ts` and add unit tests.
3. Add encrypted SQLite and biometric app lock via EAS development builds.
4. Introduce a secure export/restore flow and transaction search.
5. Add a proper native date picker and accessible charts.
6. Design dedicated credit card/debt and budget models.

No real financial data should be pasted into AI chats or committed to GitHub.
