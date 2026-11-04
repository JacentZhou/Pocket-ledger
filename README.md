# Pocket Ledger PWA — v0.8

Personal finance tracker for iPhone, iPad and desktop using an **installable offline-first web app**. No Apple Developer membership is required. The original native iOS app remains in the `native-ios` Git branch.

## What works

All manual transactions, account balances, income/expense categories and icons, recurring plans, credit cards, search filters, charts, Settings sections, and v0.7 cash-flow Forecast/Upcoming/Calendar are preserved. Data remains local to the browser using IndexedDB; no data is uploaded to the GitHub Pages server.

### Install on iPhone

1. Enable **Settings → Pages → Source: GitHub Actions** in this repository if not already enabled; wait until `Deploy Pocket Ledger PWA` succeeds in Actions.
2. Open **https://jacentzhou.github.io/Pocket-ledger/** in Safari on the iPhone.
3. Tap the Safari **Share** button → **Add to Home Screen** → **Add**.
4. Launch using the new Home Screen icon. Open it online once and verify it also launches offline.

**Important:** Web-app storage is separate from native iOS app storage, and may also be different between a Safari tab and Home Screen installation. Native iCloud backups are NOT imported into the PWA. You must re-enter your real transactions, unless you arrange a separate migration path.

## How data are stored

- Records are stored on-device in Safari/WebKit **IndexedDB**, under the website's origin (using the `pocket-ledger-v1` ledger key).
- Data are not cloud-backed, synchronized, encrypted separately by the app, or sent to the GitHub Pages host. Static app code is hosted publicly; personal records are not.
- iOS/browser eviction, clearing website data, deleting the Home Screen app, or device loss can permanently delete the records. **Do not make this the only copy of important financial information** until a proper backup/export method exists.
- Future-dated planned payments remain forecasts, not actual spending; real transactions only count for current balances when their dates have arrived.
- Browser native confirmation dialogs replace React Native's native-only alerts so deleting transactions, clearing the ledger and recording payments remain interactive.

## Develop and deploy

```sh
npm install
npm test
npm run web
npm run build:web
```

Production `dist/` includes Expo's static web bundle, manifest, iOS Home Screen icon, and a service worker that pre-caches app assets for offline startup. Expo's `experiments.baseUrl` is `/Pocket-ledger` for GitHub Pages project hosting. Deployments are automated from `main` using `.github/workflows/pages.yml` when Pages is configured to use GitHub Actions.

The PWA is not a native iOS app. It cannot access the removed native iCloud storage module or receive guaranteed background work while the app is closed. Offline caching and browser storage still need a real iPhone test.
