# Pocket Ledger v0.5 — Category icons and monthly planned posting

Pocket Ledger remains a manual, offline-first personal finance tracker built with React Native and Expo.

## New in v0.5

- Select emoji icons for expense and income categories, add/rename/delete both types via the new **Settings → Spending / Income** category tabs. Category colour selectors are removed. Older stored colours remain valid for chart and backup compatibility.
- Activity rows now show category icons, description, account and amount without repeated type labels. Expenses are red, income green, and transfers neutral.
- Planned entries now support income in addition to expenses and credit-card repayments, with filter tabs and tap-to-edit details. Record or delete individual planned entries from their editor.
- Optional **Automatically record on the 1st** setting. When enabled, the app posts this month's remaining planned expense occurrences as transactions dated on the first of the month when it opens. Weekly/fortnightly occurrences are included, but income and card repayments are not auto-posted.
- A separate **Record this month's expenses now** button posts remaining eligible expenses after confirmation.
- Planned postings are linked to schedule IDs and original due dates to prevent duplicate posting. Upcoming due dates skip already posted future occurrences.
- Legacy local data and existing iCloud backup format remain supported.

**Accounting caution:** Choosing to post bills on the first of the month immediately changes balances, spending charts, and cash flow, even when the actual bills have not been paid yet. Check for manually recorded duplicate expenses before enabling. This feature does not pay bills or contact banks.

## Testing and iCloud

Run `npm install`, `npm test`, and `npx expo-doctor`; test a signed native iOS build before using real financial data. Automatic iCloud backup from v0.4 requires Apple Developer signing and iCloud entitlements; Expo Go cannot access the native module. Backups are not separately password-encrypted.

--- 

## v0.4 iCloud setup and background

Pocket Ledger is a React Native + Expo (SDK 57) manual personal finance tracker for iPhone and iPad. Account balances, credit cards, categories, transactions, spending insights and recurring payments remain available.

## New in v0.4

- Automatically writes a versioned snapshot to the app's private iCloud Drive container after successful local saves, then retries failed uploads when the app reopens or remains active.
- Keeps three rotating snapshots per installation, with separate names per device.
- If a new installation has no local financial data, automatically tries to recover the newest *valid* iCloud snapshot. **Never overwrites existing on-device data.**
- Removes the manual export, sharing, file picker and restore buttons.
- Displays iCloud status and the last app-side save time under Accounts.

## iCloud setup (required)

1. Use an Apple Developer account with iCloud capability. A proposed iOS bundle ID, `com.jacentzhou.pocketledger`, is specified in app.json. Confirm or change it **before your first signed build**. The bundle ID becomes tied to the app identity and iCloud container.
2. Enable iCloud Documents for that App ID in Apple Developer and associate a matching iCloud container. The Expo config plugin uses `iCloud.$(CFBundleIdentifier)` and `ios.usesIcloudStorage: true`.
3. On the iPhone or iPad, sign in to an Apple Account and enable iCloud Drive.
4. Install a **signed native EAS/Xcode build**, not Expo Go. From a cloud terminal or Codex environment:

```sh
npm install
npm test
npx expo-doctor
npx eas-cli build --platform ios --profile preview
```

An internal iOS build needs appropriate Apple provisioning and registration for the test device. The Apple Developer login/capability approval must be completed by the app owner. Native iCloud cannot be tested in Expo Go.

## Safety and limitations

- **This is opportunistic automatic backup while the app runs**, not a guaranteed background job while iOS has suspended or terminated it. Upload attempts occur after edits, on app activation and periodically during an active session after failure.
- An upload success means iOS accepted the file into its iCloud container. Propagation to another device is controlled by Apple. Do not treat the app-side timestamp as proof of off-device delivery.
- On first installation, recovery only runs if no local data exists. There is no multi-device merging or real-time sync. Each device's rotating snapshots are kept separately.
- Older snapshots can remain after Clear all records; the newest empty ledger is backed up automatically. This is not an iCloud data-erasure feature.
- Backups are **readable JSON**, not separately password-encrypted by Pocket Ledger. Local AsyncStorage is also not independently encrypted. Test with fictional records before using real financial information.
- Demo data are not uploaded to iCloud. No banking credentials or app-operated servers are involved.
- No manual backup or manual restore controls are provided in v0.4.

## Tests

Run `npm test` for the existing finance calculations, credit card accounting, transaction grouping, backup schema, and new snapshot naming/rotation/date-selection regression tests. The iCloud transport itself, Apple entitlements, cross-install recovery and propagation **still require real-device testing**.

## Development notes

- iCloud module: `@oleg_svetlichnyi/expo-icloud-storage` (native iOS; compatible with Expo SDK 53+).
- iCloud snapshots: `PocketLedgerAutomaticBackups/backup-<installation-id>-slotN.json` in the app's private iCloud Documents container.
- Shared finance storage key remains `pocket-ledger-v1`, preserving data from v0.1–v0.3.
- Do not commit real account or transaction records, credentials, or backups to GitHub.
