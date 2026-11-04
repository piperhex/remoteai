# Token Usage lifecycle verification

Task 04, Windows, 2026-11-01. Starting implementation: `04776426e`.
The older review baseline was rechecked against the working implementation before editing.

## Behavior and ownership

- Updated 2026-11-02: `DashboardApp` mounts the lazy Token Usage panel on its first visible visit,
  then retains chart instances and interaction state across tab changes. Hidden/minimized windows
  pause polling, drawing and animation without disposing charts. Reopening reuses a fresh cached
  snapshot or refreshes stale data. The standalone window uses the same boundary. Visible unfocused
  windows remain eligible to display data. Measurements below describe the original November 1 implementation.
- An unfocused Windows window can be hidden without document, focus or resize events.
  While Token Usage is selected, one native state-query pair runs at a time and schedules
  the next check one second after completion. Hidden windows retain these inexpensive
  checks for restoration; they do not read usage or draw charts after detection. Leaving
  the feature removes native/document subscriptions and its timer, including after late replies.
  This is not a claim of zero IPC or instantaneous hide detection.
- The existing `createDashboardLoader` single-flight scheduler remains in use. Range changes
  queue the latest request and obsolete effects cannot publish their responses.
  The original issue was unnecessary work in mounted hidden panels, not unlimited overlapping requests.
- Polling consumers share the four-query snapshot through Web Locks and IndexedDB, then
  schedule the next tick from its completion time. Module memory is only a local fast path.
  The cache is limited to 24 entries and 8 MiB of serialized UTF-16 values, with a five-minute
  maximum reuse age and lazy eviction. Failed/partial results are not retained.
- Cache keys include the source, calendar start and long-context threshold. Provider/account
  rankings are computed from the returned full dataset; there is no Provider-filtered backend
  query in this panel. Changing a display selection does not select a different server dataset.
- Native local usage belongs to the machine's application profile, across its Provider
  accounts. Remote requests execute this service on the selected host. The Web client scope
  includes server URL, account email and device ID; existing scope changes discard old results.
  Cloud-account official usage remains a separate uncached request.
- Hosted-browser credentials are hashed into the source key. Switching/clearing credentials
  invalidates the retired source on the next read. A request that outlives its credential is
  neither cached nor published. Signing back in with the previous credential requires a new read.
  A generation check also rejects an old A response after an observed A-to-B-to-A transition.
  Missing credentials or unavailable secure hashing bypass shared caching.
- Web Locks require a compatible same-origin storage partition. Without them, the original
  per-consumer single-flight remains, and IndexedDB rejects an older late write; cross-window
  request deduplication is not claimed in that fallback.
- `ChatTokenSummary` uses the same native-aware visibility hook, pauses requests and removes
  chart content while hidden.
  `ChatPage.tsx` has no task-04 change: `token-summary` is an independent route and its portal
  must remain visible while the surrounding ChatPage has `active=false`.
- Native phone TokenSummary already uses its `foreground` state. No native phone layout or copy
  was changed. This task does not modify the project editor or other Dashboard sections.

## Fixed observation comparison

The Playwright fixture uses bundled Chromium through `scripts/test-browser.mjs`, one worker,
the running desktop UI, a one-second refresh interval and a fixed 40 ms synthetic delay on each
read. Each observation lasts 5,100 ms. Development React StrictMode is enabled. The baseline
Vite transform restores the starting hook and always-mounted panel without changing Git HEAD.
Counts are JavaScript read invocations, dashboard function executions and ECharts `setOption`
calls; they are not CPU, frame-time, memory or production latency measurements.

Each of the four request columns had the same value (entries, daily, breakdown, quota):

| State | Before: each request type | After: each request type | Before: renders / draws | After: renders / draws |
| --- | ---: | ---: | ---: | ---: |
| Never visited | 7 | 0 | 24 / 91 | 0 / 0 |
| Open | 5 | 6 | 20 / 70 | 10 / 48 |
| Hidden | 5 | 0 | 20 / 70 | 0 / 0 |
| Reopened | 5 | 5 | 20 / 70 | 10 / 48 |
| Main + independent page, total | 10 | 5 | 40 / 140 | 18 / 81 |

The open count includes boundary/mount timing. Simultaneous consumers can alternate which
window performs the shared read; total counts are the meaningful comparison. A separate
single-sample check kept a read pending for three seconds: navigation completed in 521 ms
before and 409 ms after. This proves the tested frontend interaction remains available during
an asynchronous read; it is not evidence of a measured speedup or native disk/network latency.

Raw reports: `.codex-tmp/token-lifecycle/before.json` and `after.json`.
The retained reports and source-hash manifest are also under `.artifacts/task-04/`.
The current browser rerun passed all nine cases with exit code 0. PowerShell renders Node stderr
warnings as `NativeCommandError` records in the log; the runner's explicit exit code and test
results distinguish those warnings from failing tests.

## Reproduction and executed checks

From `apps/desktop`:

```powershell
npx vitest run src/components/TokenUsageDashboard/useWindowVisible.test.tsx src/components/TokenUsageDashboard/lifecycle.test.tsx src/components/TokenUsageDashboard/queryCache.test.ts src/components/TokenUsageDashboard/EChart.test.tsx src/remoteChat/useTokenSummary.test.tsx src/remoteChat/tokenSummary.test.ts src/remoteChat/hostFormattedCopy.test.ts src/i18n/tokenSummaryLanguage.test.tsx --maxWorkers 1 --reporter=default --reporter=json --outputFile.json=../../.codex-tmp/token-lifecycle/unit-tests.json
$env:TOKEN_BASELINE='1'
npx playwright test --config e2e/token-lifecycle.config.ts token-lifecycle.pw.ts
$env:TOKEN_BASELINE='0'
npx playwright test --config e2e/token-lifecycle.config.ts
```

The current unit run passed 47 tests across eight files, including the existing language regression.
The six cache browser checks cover
independent JavaScript contexts, query/source isolation, credential removal and return,
entry/byte bounds, identity changes during a pending request, and older late writes without
Web Locks. A source-invalidating pending read cannot repopulate the local cache.
The browser reports record SHA-256 hashes of the tested source. Earlier evidence is preserved
in `after-before-native-hide-fix.json`; it is not used as proof of the corrected native boundary.

From `apps/web`:

```powershell
npx playwright test --config playwright.token-lifecycle.config.ts
```

Both desktop (1440 px) and mobile (390 px) actual App routes passed: ChatPage is hidden while
Token Summary remains visible, returning stops requests for 5,100 ms, and reopening refreshes
while retaining the three-week range. This was run after removing the experimental ChatPage
active guard. It uses the existing simulated remote transport, not a production remote host.

The isolated Windows probe sources are retained in `.artifacts/task-04/`. To replay on this
Windows development machine with the already-built matching Tauri dependency artifacts, copy
`native-probe.rs`, `native-probe.exe.manifest`, `build-native.ps1` and `native-smoke.mjs` into
`.codex-tmp/token-lifecycle/`, then run from the repository root:

```powershell
powershell -File .codex-tmp/token-lifecycle/build-native.ps1
node .codex-tmp/token-lifecycle/native-smoke.mjs
```

The linker script uses the coordinated heavy mutex and embeds the Common Controls v6 manifest.
Its recorded SDK and dependency paths are specific to this machine; it is an isolated
verification executable, not the production application or a portable release-build recipe.
The runner starts its own Vite process and WebView profile, then closes only its own processes.

The existing Rust test
`local_proxy::tests::token_usage_breakdown_keeps_async_polling_responsive_while_database_is_busy`
passed against the already-built actual crate test executable (one test, zero failures).
It holds the usage database lock and verifies an independent future on the same executor can
run before releasing that lock. `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check`
also passed. Task 04 has no production Rust modifications.

The final coordinated verification passed with exit 0 on the recorded source hashes:
`npm run build --workspace @codex-switch/desktop` (TypeScript, service TypeScript, Vite),
`npm --prefix apps/web run build` (TypeScript, Vite), and
`cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check`.
Logs are `desktop-build-final.log`, `web-build-final.log`, and `rust-fmt-final.log` under
`.codex-tmp/token-lifecycle/`. Vite reported non-fatal chunk-size and shared static/dynamic
import warnings; this change does not claim a measured bundle-load improvement.
The commit executes the original complete `npm run check` hook with serial Lerna under
the heavy-then-Git mutex order; its execution log is `commit.log` in the same directory.

## Real Windows WebView results

The final isolated Tauri/Wry process passed (`native-smoke.log`, exit 0; `native.json`,
`success: true`). It uses the actual production window helper and capability manifest,
the current React components, synthetic asynchronous usage IPC, and an isolated profile.
The main window matches the production disabled-background-throttling setting. These are
two independent native WebViews, not two pages in bundled Chromium. Both reported origin
`http://127.0.0.1:1544`, IndexedDB and Web Locks; concurrently querying a unique key returned
`[1, 1]` from an atomic backend counter, proving one read through their shared storage partition.
Production code uses the same default app profile and App URL scheme for both windows,
without a separate data directory; packaged-release behavior was not run.

Each stable observation lasts 5,100 ms. "State pairs" counts the application hook's
`isVisible` plus `isMinimized` calls, not test-only control/inspection IPC. Four backend
counts are entries/daily/breakdown/quota; they were equal in every row below. JS invocation
and backend completion boundaries can differ by one in-flight read; the raw report retains both.

| State | Each backend read type | Renders / draws, total | State pairs, total |
| --- | ---: | ---: | ---: |
| Neither window visited | 0 | 0 / 0 | 0 |
| Main open | 5 | 5 / 30 | 5 |
| Main minimized, stable | 0 | 0 / 0 | 5 |
| Main restored | 5 | 5 / 30 | 5 |
| Main hidden while unfocused, stable | 0 | 0 / 0 | 5 |
| Main shown while still unfocused | 5 | 5 / 30 | 5 |
| Left panel with state query pending | 0 | 0 / 0 | 0 |
| Main + independent window | 5 | 10 / 60 | 10 |
| Independent window destroyed, main remains | 5 | 5 / 30 | 5 |
| Independent window recreated | 4 | 9 / 54 | 10 |
| Left panel with usage read pending, stable | 0 | 0 / 0 | 0 |

Before the silent-hide fix, the real hidden window continued each read type five times,
rendered five times and drew 30 times in 5,100 ms (`native-before-hide-fix.json`). In the
corrected run, hide was recognized after 842 ms. No read was pending at the hide command,
but one new batch of all four reads, one render and six draws occurred before detection.
This transition is explicitly separate from the zero-usage stable period. Minimize detection
took 48 ms; restore/show until chart attachment took 113/1,341 ms. These are individual
observations including automation/rendering delay, not upper bounds or latency benchmarks.

The slow-state scenario delays delivery of real state-query results by two seconds. At most
one pair (two individual calls) was pending. Leaving during that pair removed all future
state/data work and late replies did not restart it. With four usage reads delayed for three
seconds, navigation away took 31 ms; the subsequent stable period had no reads or chart work.
The remote summary component also stopped requests and removed chart DOM while minimized,
then refreshed on restore. Its transport/data are simulated, not a real remote computer.

## Screenshot evidence and remaining platform checks

All listed screenshots were opened and visually inspected. Paths are relative to
`.codex-tmp/token-lifecycle/`.

| Platform / mode | States | Files |
| --- | --- | --- |
| Windows bundled Chromium / desktop local preview, 1440 px | Open, hidden, reopened | `after-desktop-local-{open,hidden,reopened}-1440.png` |
| Windows bundled Chromium / independent usage page, 1440 px | Open | `after-desktop-independent-open-1440.png` |
| Windows bundled Chromium / remote component fixture, 1440 and 390 px | Open, reopened | `after-web-remote-{open,reopened}-{1440,390}.png` |
| Windows bundled Chromium / actual Web App remote route, desktop and mobile | Open, returned to Discover, reopened | `after-web-route-{desktop,mobile}-{open,hidden,reopened}.png` |
| Windows Wry/WebView2 / local panel fixture | Open, restored from minimize, shown after unfocused hide | `after-native-local-{open,restored,shown}.png` |
| Windows Wry/WebView2 / independent window fixture | Open, destroyed and reopened | `after-native-independent-{open,reopened}.png` |
| Windows Wry/WebView2 / remote component fixture | Open, restored | `after-native-remote-{open,restored}.png` |
| Windows native window frame / local fixture | Visible panel after restore | `after-native-window-frame.png` |

Browser pages alone do not establish native WebView storage sharing; the native probe above
supplies that evidence for its development origin/profile. Packaged release mode, macOS/Linux, a real remote
computer and physical Android/iOS remain unverified. No runtime leak, measured stutter or
Mermaid attribution is inferred from the earlier build OOM.
