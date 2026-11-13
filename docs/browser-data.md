# Browser history and passwords

The settings menu exposes history and password management in Native, desktop local/remote,
and mobile/desktop Web. Shared account data lives in `shared/browser/data`; Native supplies
platform views, random bytes, and background PBKDF2 through its BrowserData module.

## Storage and synchronization

- History stores completed HTTP(S) visits, grouped by local date, with search and individual deletion.
  The account document retains up to 3,000 visits and 500 passwords, bounded to 4 MiB.
- Authenticated lounge connections negotiate `browserData`, then exchange `browser-data-read/save`
  messages. The backend selects the owner from the authenticated peer, serializes account updates,
  checks revisions, and broadcasts accepted documents only to that account's devices.
- Clients persist outstanding edits and merge them against the latest server revision before saving.
  A stale offline device does not re-upload its entire old history after another device deletes it.
- Password origins, usernames and passwords are AES-256-GCM ciphertext. Each operation uses a fresh
  nonce and authenticates the vault salt and record ID. PBKDF2-HMAC-SHA256 uses 600,000 iterations,
  a random 128-bit salt and a separate user passphrase of at least 12 characters.
- Native uses Java/CommonCrypto background workers; Web uses SubtleCrypto. The server never receives
  the passphrase or derived key. Keys and decrypted entries remain in memory and lock after five
  minutes of inactivity or application backgrounding. Native persistence contains ciphertext in SQLite;
  it does not store the vault passphrase in SecureStore.
- Simultaneously initialized vaults remain separate until the user unlocks and merges the conflict.
  A forgotten passphrase cannot be recovered by the server. Future changes to KDF parameters require
  a versioned migration; do not change the current constants for existing documents.

## Platform behavior

- Native and Windows recognize top-level HTTPS login form submissions and ask before saving.
  Filling is an explicit password-manager action, requires the exact origin (including port), and
  does not submit the form. Cross-origin form actions and cleartext HTTP pages are excluded.
- Hosted Web cannot inspect or fill arbitrary cross-origin iframes. It provides synchronized history
  and password CRUD, with a visible explanation of the browser's restrictions. Cross-origin history
  records the address opened by the application; internal redirects cannot always be inspected.
- History and password deletion follow the selected time range and synchronize. Tab closing applies
  only to the current device. Cookies/site data and cache apply to the complete local browser profile,
  regardless of the selected time range, as explained beside those choices.
- Windows and Native provide independent cookies/cache clearing. The portable non-Windows desktop
  API currently requires selecting cookies and cache together; individual requests return an error
  without clearing unselected data. Physical iOS and macOS verification is still required.
- Desktop browsing uses a dedicated `browser-profile` directory so clearing website data cannot erase
  the application's account session. Websites previously using the shared app profile require a new login.

## Backend rollout

Apply the normal backend release process including `sql/20261113-browser-data.sql` (bootstrap migration
031). Until an updated server advertises `browserData`, clients retain local changes and show the offline
sync state. A new account password vault requires a successful initial read to prevent overwriting an
unseen existing vault. Source changes alone do not deploy or enable synchronization on production.

## Verification

- Desktop unit tests: `browserData.test.ts`, `browserPasswordPage.test.ts`, `browserBookmarks.test.ts`.
- Backend: Go vet/full tests and `TestBrowserDataPostgresPersistence` against isolated PostgreSQL.
- `apps/desktop/scripts/verify-browser-data.mjs` uses bundled Chromium for mobile/desktop Web; `--native`
  attaches to the isolated `provider_browser::data_smoke::opens_browser_data` WebView2 test on port 9355.
  Vite must serve the harness on port 1572. The engine test additionally uses port 9356 and local HTTPS
  port 18443; its self-signed certificate exception exists only in the isolated Rust test.
- `apps/desktop/scripts/verify-browser-data-engine.mjs` checks trusted form capture, save/fill and real
  selective Cookie/localStorage clearing. It never operates on the installed application's profile.
- Native fixture: build with `scripts/browser-data-fixture.init.gradle`, install only
  `com.codexswitch.mobile.browserdatatest`, then run `scripts/verify-browser-data-android.mjs` with
  `ANDROID_SERIAL`. `--login` exercises the real WebView bridge. The fixture's Node-generated vault
  verifies cross-platform decryption; all usernames, passwords and origins are fictional.
- Screenshots and run results are written to `.codex-tmp/browser-data`. Restore the device's original
  font scale when verification finishes. The scripts cover 1.0/1.3 physical Android font scales.
