# Pocket Ledger v0.7 — Cash Flow Forecast

An offline-first personal finance app for iPhone and iPad, built using React Native and Expo. Track actual money movements manually and preview upcoming payments without recording them early.

## What changed in v0.7

- **Planned → Forecast:** account-specific projections over 7, 14, 30, 60 or 90 days, including a daily chart, lowest projected balance, shortfall warnings and a conditional safe-to-spend estimate.
- **Planned → Upcoming:** upcoming and overdue expenses, income and card repayments, with tap-to-confirm as an actual transaction, using today's date and preserving the original planned due date.
- **Planned → Calendar:** monthly calendar of due dates, including linked payments already recorded.
- **Settings → Accounts:** optional minimum-balance buffer for cash/bank accounts or minimum available credit for credit cards.
- **No automatic first-of-month recording:** planned transactions stay projected until confirmed. Old settings are retired during migration.
- **Historical figures and actual account balances exclude future-dated transactions**; future-dated actual entries appear in forecasts instead.

## Accounting rules

- Income and expenses are only actual after being entered or confirmed. Plans alone do not affect the recorded balance or historical spending totals.
- Planned credit-card repayments are transfers; they reduce both bank cash and card debt, without counting as additional expense.
- Every scheduled occurrence is linked by `(scheduleId, scheduledFor)` when confirmed, so it is not projected twice. Out-of-order payment confirmation does not hide earlier outstanding instalments.
- Overdue obligations are projected as payable today; on a single date, expenses/repayments are conservatively applied before income.
- Future-dated *actual* transactions are excluded from today's actual balance but are included on their dates in the forecast.
- Older v0.5 first-of-month posts remain untouched; review them manually as the app cannot safely distinguish early recorded payments from real ones. Deleting/editing a linked transaction can change whether the corresponding plan appears pending.
- A manually entered transaction without a plan link is not matched automatically. Mark the plan paid instead of entering a duplicate payment manually when possible.

## How to use it

1. Add a bank, savings, cash or credit-card account under **Settings → Accounts**. Record its opening balance (for cards, starting debt) and an optional buffer or credit limit.
2. Enter actual income/expenses/transfers in **Activity** or using **+ Add transaction**.
3. Create recurring bills, expected income and credit-card repayments under **Settings → Planned payments**.
4. Open **Planned → Forecast**, select your account and horizon, and check any projected shortfalls.
5. Open **Planned → Upcoming** and tap a scheduled item to **Record paid** when it actually happens; it then appears in Activity and no longer counts as a pending plan.
6. Use **Planned → Calendar** to inspect due dates and linked paid items.

Forecasts are estimates based only on the information you entered, not verified balances from your bank. The safe-to-spend figure assumes expected income arrives, all planned payments occur, and you incur no unplanned costs. Do not use it as a guaranteed spending allowance.

## Install, test and build

```sh
npm install
npm test
npx expo-doctor
npx eas-cli build --platform ios --profile preview
```

The native iCloud module needs a properly signed iOS build. Expo Go cannot exercise it.

The package uses `@oleg_svetlichnyi/expo-icloud-storage` (native iOS) and Expo SDK 57. The Expo configuration declares a proposed bundle identifier `com.jacentzhou.pocketledger`; confirm this identity before the first signed build. Enable iCloud Documents for the App ID and a matching iCloud container in Apple Developer, and turn on iCloud Drive on the device.

## iCloud and privacy

- Records persist locally with AsyncStorage using the existing `pocket-ledger-v1` key. Old account, category, transaction, and schedule data remain compatible.
- Automatic iCloud snapshots from v0.4 continue after local saves and on app activation. They do not guarantee uploads while iOS fully suspends the app, and are not real-time multi-device sync.
- A fresh installation without local data tries to restore the newest valid snapshot; it does not overwrite an existing ledger.
- Backups are readable JSON in the private app iCloud container and are **not independently password-encrypted**. Do not put actual bank credentials or financial exports into the GitHub repository.
- This build has passed source parsing and pure regression tests, but native iCloud transfer, backup recovery and the complete UI still need signed-device testing before use with real financial records.

## Tests

`npm test` runs the existing finance, iCloud backup, category and recurring-plan tests plus `test-forecast.cjs` for future-dated actuals, shortfalls, buffers, credit-card repayments, calendar entries, duplicate prevention and out-of-order payment confirmation.

The previous month-posting pure helper is intentionally retained to support legacy tests, but it is **not wired to the UI or executed automatically**.