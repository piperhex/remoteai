# Project editor service verification

This Windows harness compiles the production editor source, including its `spawn_blocking` calls,
filesystem operations, locks, digest validation, and tests. Only the Tauri scheduler/error/response
adapters are substituted. It is not a packaged Tauri application or a remote network test.

From the repository root:

```powershell
cargo test --manifest-path scripts/project-editor-harness/Cargo.toml --jobs 1 -- --test-threads=1
node scripts/project-editor-harness/prepare.mjs
node scripts/project-editor-harness/measure.mjs
```

`prepare.mjs` uses `git show 04776426e` to extract the initial service without changing the checkout.
`measure.mjs` also extracts the original frontend transfer function, bundles both frontend versions,
and creates reproducible UTF-8/CRLF logs of approximately 128 and 256 MiB. Each version runs in three
fresh Rust/Node process pairs per size. Results go to `.codex-tmp/project-editor/measurements.json`.

The measurements include Windows process high-water working set, API text-ready latency, first
service request latency, next-page and page-save latency, response bytes, and small read/write requests
in another project during opening and saving. The Node frontend is the actual transfer function, not
CodeMirror or a WebView. Disk fields are logical temporary file sizes derived from the observed source
size and the verified snapshot/staging lifecycle; they are not free-space or allocation-unit sampling.
Page save keeps the same contents to avoid changing the workload between repetitions. OS file caches
are not flushed. Other conversations may run checks on this machine, so timing ranges are descriptive,
not isolated-machine or statistical latency guarantees.

For actual app-component browser tests, use Playwright's bundled Chromium:

```powershell
cd apps/desktop
npx playwright test --config scripts/playwright.project-editor.config.ts
```

The browser adapter connects production local/remote/Web entry components and the generated native
offline document to the real Rust service. Separate fixture-based regressions preserve SSH editing,
search, replacement, and undo. This does not replace packaged Tauri, a real remote connection, or an
Android/iOS application test.

## Native hosts

After building the desktop `codex_switch_lib_tests` target, the isolated Windows host can reuse its
dependency libraries. Run the build under the repository's heavy-verification mutex:

```powershell
node scripts/project-editor-harness/build-native.mjs
```

The builder reads `.codex-tmp/project-editor/tested-rust-artifact.json`, or an explicit
`PROJECT_EDITOR_TEST_BINARY` path copied from the successful Cargo test's `Running` line. It resolves
all Rust libraries using that target's Cargo dependency fingerprints. Picking the newest library of
each name is unsafe when the target directory contains several versions or feature combinations.

Then run the lightweight UI checks:

```powershell
node scripts/project-editor-harness/native-test.mjs
```

This starts a separate Tauri/Wry application, WebView2 profile, and Vite server. It attaches to the
owned WebView over CDP, using the browser arguments from `scripts/test-browser.mjs`. The production
editor service handles a 256 MiB sample created by `measure.mjs`; app-component local, remote, and Web
entries use that service. The remote transport remains a local adapter. Results, timer observations,
and screenshots go to `.codex-tmp/project-editor/`; the normal installed app is not used or replaced.

The physical Android fixture uses its own application ID, `com.codexswitch.mobile.filebrowsertest`.
Build it under the same heavy-verification mutex:

```powershell
$env:NODE_ENV = 'production'
$env:NODE_PATH = "$PWD/apps/native/node_modules"
apps/native/android/gradlew.bat -p apps/native/android --no-daemon --max-workers=1 `
  -PreactNativeArchitectures=arm64-v8a `
  -I "$PWD/apps/native/e2e/project-browser.init.gradle" :app:assembleRelease
```

Select the reserved device explicitly before running:

```powershell
$env:ANDROID_SERIAL = 'f25ca15c'
node apps/native/e2e/project-editor-window-test.mjs
```

The fixture exercises the native React Native shell, generated offline document, and production
bridge with an in-memory file service. It checks page navigation, dirty-page confirmation, retained
edits, back navigation, and Chinese text at font scales 1.0 and 1.3. A `finally` block restores and
reads back the original font scale, removes only the independent fixture app, and restores the
previous activity. Cleanup failures prevent a passing result. Device state, results, and screenshots
are saved under `.codex-tmp/project-editor/android/`. This is not a remote-network or Rust-on-Android
test; the real filesystem service is verified separately in the Rust and Windows/browser tests.
