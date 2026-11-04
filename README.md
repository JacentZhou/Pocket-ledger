# Pocket Ledger v0.3 — manual personal finance tracker

A React Native + Expo (SDK 57) app for recording bank/savings/cash/credit-card accounts, manually entered income/expenses/transfers, planned payments and financial insights. The primary data stays on this device in AsyncStorage. No bank credentials, banking API, application server or AI service is used. Defaults: AUD and Monday-start weeks.

## New in v0.3

### Manually back up to iCloud Drive; restore from Files

**Export:** On **Accounts → Backup and restore → Back up to Files / iCloud Drive**, the app generates a dated `pocket-ledger-YYYY-MM-DD-<timestamp>.json` backup and opens the iOS share sheet. Choose **Save to Files**, select **iCloud Drive**, choose a folder and tap **Save**. Open the Files app to verify the backup is there. You can save to **On My iPad** instead if you prefer.

**Restore:** On **Accounts → Restore a backup** (or **Restore from Files / iCloud Drive** on the empty welcome screen), choose the file in the iOS Files picker. The app checks the backup's version, accounts, transaction amounts/dates/times, IDs, and account links. It then asks you to confirm replacing the current on-device data. Confirming replaces your accounts, transactions, categories and scheduled payments; cancel keeps the current data. Invalid backups don't replace existing data.

**Important limitations:** This is an **on-demand export to iCloud Drive**, not automatic iCloud sync or silent scheduled backup. The sharing API cannot determine whether you actually saved the file, so confirm its presence in Files. **The `.json` backup is readable plaintext, not password-encrypted.** Do not share or publicly upload it. Keep backups in a private location. Do not use the prototype for important financial records before adding password-encrypted backups, an encrypted local database, and end-to-end QA. Cloud files may be accessible to anyone with access to the Apple Account or shared iCloud folder. Backups do not contain bank passwords because the app does not collect them.

### Transaction time

- Every **new** manually entered transaction defaults to the device's current local time in `HH:mm` 24-hour format (captured when you open the New transaction form). You can edit both date and time before saving and any time later.
- Recording a planned payment uses the date and time when **Record paid** was tapped.
- Older v0.1/v0.2 transactions remain intact but have `time: null`, because their original entry time was never saved. No fake time is assigned. When you edit one, you can fill in a known time or leave it blank.
- Entries are sorted by date, then time (newest first). The timestamp is searchable. No timezone conversion is applied: the saved time is local wall-clock time.

### Compact, grouped Activity page

- **Activity** shows a compact search bar, transaction-type chips, and an expandable **More filters** section (account, category, date range, amount range).
- Entries are grouped under day headings (e.g. **Wed, 4 Nov 2026**). Each heading shows the sum of **Out** (expenses) and **In** (income) for that date. These sums apply to transactions currently included by the search/filter. Internal transfers do not affect either sum.
- Rows display **description, type, account(s), and amount only**, with no repetitive date, Edit, or Delete text. Tap any transaction to edit it. The **Delete this transaction** button appears inside its edit form with a confirmation prompt.
- Tightened Activity page spacing, smaller row icons and text, and roughly 46-pixel transaction rows aim for approximately 8–10 visible entries on typical tablet screens, depending on height, device font scale, and number of date headings.

## Existing features from v0.2

- Create and edit account balances; track credit-card debt, credit limit and repayments. A card purchase counts as spending; repayment is a transfer and doesn't count as spending twice.
- Add, edit, recolour or delete expense categories; 24 preset colours.
- Record manual expenses, income and transfers and filter by type, date, account, category, amount or description.
- Record scheduled/repeating payments (weekly, fortnightly, monthly, yearly).
- Weekly, monthly, year-to-date and custom date-range insights and graphs.

## Update your existing GitHub repo from an iPad

1. Extract `pocket-ledger-v0.3.zip` in Files.
2. In your existing **private** `pocket-ledger` repository, replace the contents of `App.js`, `README.md`, `test-calculations.cjs`, `package.json` and `app.json` with the new versions. Don't create a new repository; don't upload the ZIP itself as the source tree.
3. Open **Codex** with that repo and ask it to run `npm install`, `npm test`, `npx expo install --check` and `npx expo start --tunnel`, correcting dependency/version issues if necessary.
4. Install Expo Go on your iPad and open the Expo project over the published tunnel. For full iOS release testing use an Expo EAS build.
5. Test backup **export → Save to Files → Files verification → restore** using *fictional data* before relying on the feature. Also test with an already populated app, because restore replaces the local data.

### Local Node.js commands

```bash
npm install
npm test
npx expo install --check
npx expo start --tunnel
```

SDK 57 dependency additions in v0.3:

```json
{
  "expo-file-system": "~57.0.7",
  "expo-sharing": "~57.0.24",
  "expo-document-picker": "~57.0.3"
}
```

Previewing via Snack requires adding **all four** native/Expo packages (AsyncStorage, FileSystem, Sharing, DocumentPicker) through the Snack dependency UI. Browser (web) preview cannot export local files through the native iOS share sheet; backup/restore is intended for iPhone/iPad. Validate the final dependency compatibility with `expo install --check` in Codex.

## Accounting rules

- Asset balance = opening balance + income − expenses − transfers out + transfers in.
- Credit card debt owed = opening debt − credits/refunds + purchases + transfers out − transfers in.
- Net worth = asset balances − credit card amounts owed.
- Spending and income summaries exclude transfers and unpaid planned payments.
- Refund-category income is treated as income rather than negative spending.
- Scheduled payments are forecasts until explicitly recorded as expenses or transfers.
- Opening balances represent the balance *before* your first recorded transaction; avoid double-counting earlier transactions.

## Security and testing

The local storage (AsyncStorage) is not independently encrypted; exported files are JSON plaintext. There is no passcode/biometric lock, automated iCloud sync, encrypted cloud backup, bank integration or multi-device conflict resolution. Files on GitHub should only contain code and fictional test data, never your real exported backups or personal banking information. Use a private GitHub repository but do not assume the privacy of that repository makes banking data safe to commit.

`npm test` verifies calculations, credit-card repayment semantics, transaction grouping and daily sums, time parsing and sort order, old-data migration, transaction search and backup validation/round-trip. The JSX syntax is also checked separately. **The app has not been run on a physical iPad in this environment**, so iOS share-sheet behaviour and the picker must be tested in Expo Go or an EAS build before trusting backups.
