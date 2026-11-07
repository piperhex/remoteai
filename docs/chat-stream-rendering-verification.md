# Chat streaming verification (2026-11-01)

Task 1 changes stable message callbacks, Markdown content boundaries, and the shared client stream scheduler.
It does not change history windowing, diff parsing, or Mermaid scheduling.

## Measurements

The before implementation was read from commit `04776426e` into temporary, isolated module copies.
The branch and shared source files were never reverted. Counts exclude initial mounting.

| Workload | Before | After |
| --- | ---: | ---: |
| Web: historical message executions, 120 completed messages and 40 fixed content updates | 4,800 | 0 |
| Web: actual ReactMarkdown parses for those historical messages | 4,800 | 0 |
| Web: active message executions / parses | 40 / 40 | 40 / 40 |
| Desktop local: historical message body executions, 120 completed messages and 40 callback refreshes | 4,800 | 0 |
| Desktop local: actual historical Markdown parses | 0 | 0 |
| Remote/Web controller: reducer calls / state notifications for 100 adjacent text deltas in one frame | 100 / 100 | 1 / 1 |
| Remote/Web controller: raw ordered events delivered to event subscribers | 100 | 100 |

The rendering tests wrap the real Markdown component, including its parser, rather than replacing it with plain text.
Message executions are counted at the message text selector (Web) and streaming text hook (desktop local).
The Web render workload deliberately publishes each fixed increment separately to isolate callback/content caching
from stream batching. The controller workload independently measures adjacent-event coalescing and asserts exact final text.
Desktop local Markdown already had a content cache; this task preserves that behavior.

These are deterministic development-mode unit workloads, not production FPS, latency, heap, or leak measurements.
The previous build OOM is not evidence of a runtime leak or Mermaid causation.
Visible pages use requestAnimationFrame with a 32 ms timer fallback; background timer throttling and a blocked event loop
can delay timer execution. Visibility changes and lifecycle boundaries flush pending content without relying on animation frames.

## Regression coverage

The task-specific suite passed 15 files / 110 tests; a further Markdown semantic dependency test passed separately.
Machine-readable results and raw output are in `.codex-tmp/task1-rendering/unit-results.json` and `unit.log`.
The isolated before measurements for the controller and local renderer are in `stream-baseline.log` in that directory.
After adding immediate publication when a throttled background page becomes visible, the scheduler, controller and
Markdown semantic tests passed together: 3 files / 14 tests (`final-boundaries-results.json`, `final-boundaries.log`).
The native controller, history, offline and connection regressions also passed: 7 files / 57 tests
(`native-client-results.json`, `native-client.log`). These runs overlap the earlier suite; their counts are not additive.
After task 2 integrated the mobile history window, an independent rerun of callback identity, real Markdown counts
and semantic invalidation passed 3 files / 4 tests (`after-window-integration-results.json`, corresponding `.log`).
The memo-count fixture disables asynchronous IntersectionObserver mounting to keep initial mounts out of update counts;
historical executions/parses remained 0 / 0 and active executions/parses remained 40 / 40.

Covered cases include:

- Historical row identity, active text updates, latest committed callbacks and fork/edit behavior.
- Text, presentation mode and language invalidation; file readiness changes without reparsing.
- Equations, code, images, attachments, remote file links and nested preview navigation.
- Frame publication, stalled frames, hidden pages, interleaved items and reasoning part indices.
- Completion, interruption, errors, cancellation, conversation switches, reopening and teardown.
- Late delivery after stopping, and reconciliation of history responses that already include buffered tokens.

Two existing image tests required a `matchMedia` browser shim in jsdom; their image assertions were preserved.
One existing transport test now waits for both the host's 40 ms batch and the client's 32 ms fallback frame.

## Browser and screenshot evidence

All browser tests use bundled Chromium through `scripts/test-browser.mjs`.
The browser tests run the actual application components with fixture transports, not a production server.
Native Tauri WebView execution and physical Android/iOS devices were not tested.

| Platform / mode / state | Screenshot under `.codex-tmp/task1-rendering/` |
| --- | --- |
| Web desktop, streaming, 1280 x 900 | `web-desktop-streaming.png` |
| Web desktop, historical tool expanded after completion | `web-desktop-history-action.png` |
| Web mobile, streaming, 390 x 844 | `web-mobile-streaming.png` |
| Web mobile, historical tool sheet expanded | `web-mobile-history-action.png` |
| Desktop local renderer, completed rich reply, 1440 x 1000 | `desktop-local-completed.png` |
| Desktop local renderer, interruption and continuation | `desktop-local-interrupted.png` |
| Desktop remote renderer over fixture Relay, Japanese UI with retained draft, 1440 x 900 | `desktop-remote-language.png` |

All seven screenshots were visually inspected. Web scenarios passed 2/2; desktop local/remote scenarios passed 3/3.
The desktop fixture has its own Vite cache and explicit dependency entries. Its watcher is disabled during tests,
so source changes require restarting the server. Earlier cold-start attempts timed out before navigation completed.

Re-run the browser suites with:

```powershell
npm --prefix apps/web run test:browser -- --config scripts/playwright.chat-rendering.config.ts
npm exec -w @codex-switch/desktop -- playwright test --config scripts/playwright.stream-rendering.config.ts
```

## Repository validation

Required pre-commit checks are retained. Earlier attempts exposed invalid new project-editor translations and stale
native project-browser/lounge-document assets. Their owning task repaired them without weakening the checks.
The fourth complete hook passed with serial Lerna, including all seven workspace checks, Go vet/tests, Rust formatting,
2,575 main Rust tests (29 ignored), Windows integration tests, unlock tests and installer checks.
The seven callback/content-cache files were committed as `0a31dd445` and pushed before handing ChatMessages to task 2.
The raw hook log is `.codex-tmp/task1-rendering/commit-check-4.log`.

This hook is evidence for the tested source snapshot, not final acceptance of all concurrent tasks. Task 5 changed
three Rust files after the test executable was built, so that binary does not verify its new backpressure behavior.
Executable/source timestamps and source hashes are recorded in `hook4-rust-source-window.json` beside the logs.
The subsequent stream-pipeline commit and its original hook results are reported in the task conversation.
