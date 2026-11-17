# Built-in browser downloads

Windows WebView2 downloads use the existing download manager in desktop local and remote modes.
HTTP downloads, including `blob:http` URLs, wait for the user to choose **Keep** for that individual
file. Removing a pending record cancels it. Other downloads start automatically. The browser engine
owns the transfer, so blob URLs are not fetched again through a separate HTTP client.

Progress, speed, pause/resume and completion are reflected in the download manager. Completed files
offer Open and Reveal. Files are stored under the system Downloads directory in
`Remote AI/<download-id>/<filename>` to avoid overwriting files with the same name. Completed-file
records survive application restarts; unfinished transfers cannot resume after the browser process exits.

The regular Web client's external iframe downloads remain controlled by the user's host browser.
Web application JavaScript cannot approve the host browser's insecure downloads or observe their
OS download progress. Existing application-managed Web downloads continue to use the shared manager.
The native browser integration in this change is Windows-specific.

## Verification

Run the desktop download unit tests with the repository Vitest configuration, Rust provider-browser
tests and formatting, the desktop production build, i18n and boundary checks, and Web download tests.
The real WebView2 fixture covers local/remote modes, light/default and dark/enlarged typography,
insecure blob confirmation, saved bytes, HTTP progress and pause/resume, ordinary downloads and discard.

Start Vite using `apps/desktop/scripts/vite.website-tabs.config.ts` on port 1552, then compile the fixture:

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests --no-run
node apps/desktop/scripts/test-browser-downloads.mjs <compiled-test-executable>
```

The runner uses its own app identity, a LAN HTTP server on port 18329 and CDP ports 9371/9372.
It closes its native process and server after each run. Its CDP connections preserve the native download
delegate with `noDefaults: true`; Playwright's default download override would bypass WebView2 events.
Screenshots and diagnostics are written to `.codex-tmp/browser-downloads/`.
