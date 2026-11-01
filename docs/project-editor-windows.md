# Bounded project-file editing

Text files over 256 KiB now open as UTF-8 pages, normally 64 KiB. The editor explicitly states that
search, replacement, undo, and line numbers apply to the current page. A draft can grow to 256 KiB;
an oversized edit is rejected visibly without replacing the existing draft. Changing pages uses the
existing save/discard/cancel confirmation. Saving copies the unchanged prefix and suffix, so a page is
never submitted as the whole file. Full-document preview, blame, and script actions are withheld for
partial documents. SSH keeps its existing host policy and full-document behavior.

## Storage and consistency

- Hashing, UTF-8 validation, copying, and legacy upload finalization use bounded 64 KiB buffers.
- Opening a large text file copies it into an anonymous disk snapshot while hashing and validating it,
  then scans the source again and compares digests and metadata. Later reads seek within that immutable
  snapshot; pages cannot combine different source revisions. UTF-8 codepoints, BOM, and CRLF boundaries
  are preserved. Non-UTF-8/NUL-containing files are not silently decoded or edited.
  Each scan stops at the length observed when it starts, so a continuously appended log produces a
  detected conflict instead of an endless snapshot copy.
- Saves stage prefix + page + suffix in the destination directory, preserve permissions, sync the
  replacement, prepare the next snapshot/reply, and check the source revision/path immediately before
  atomic replacement. A failed precommit step leaves the source and draft intact. Atomic rename is not
  a filesystem transaction against unrelated applications: an external writer racing after the final
  check is not prevented, and power-loss durability of the parent-directory entry is not claimed.
- A short registry mutex manages canonical path claims. File operations on the same path serialize;
  different paths proceed concurrently. Tree mutations claim the canonical project subtree. Immutable
  snapshot page reads do not hold the live-file claim. All filesystem operations and synchronous lock
  waits stay inside the existing `spawn_blocking` workers. Blame releases the file claim before Git work.
- Cancel releases snapshots, including after source removal. Cancellation reaches active scans and
  path-lock waiters. A cleanup worker expires idle views after 15 minutes (checked every 60 seconds);
  at most 32 views and 8 legacy uploads are retained. Anonymous files are removed when their last
  handle closes, including process exit. An expired view reports an error and preserves the draft.
- Renaming/moving a file or its parent rebinds the page to the new path and retains the unsaved draft.
  A conflicting rebind preserves the text and disables saving against the stale view.
- Legacy range/upload messages remain supported. Updated clients ask for a page; an older host that
  only offers full-file chunk assembly produces an update message. The native bridge validates and
  forwards range fields for read, save, and release, and pins requests to its selected project.
- Offline Android WebViews can lack `crypto.randomUUID`. View/upload/rebind tokens use cryptographic
  random bytes to produce UUID v4 values when that API is unavailable; no insecure random fallback is used.

## Reproducible measurements

See [the harness instructions](../scripts/project-editor-harness/README.md) and
[all 12 raw samples](project-editor-window-measurements.json). The baseline is the actual service and
frontend transfer function at `04776426e`, extracted with `git show`; the branch was not reset.
Windows, three fresh process pairs per version/size, reproducible Chinese/emoji/CRLF logs, release Rust,
and process high-water working sets from `Get-Process`. File caches were not flushed. Other tasks used
the same machine, so timing ranges describe these runs, not isolated-machine latency guarantees.

| Approximately | Version | Rust peak MiB | Frontend Node peak MiB | API text ready ms | First service read ms |
|---|---|---:|---:|---:|---:|
| 128 MiB | Before | 132.47 | 418.52–419.98 | 2444–2552 | 106–114 |
| 128 MiB | After | 4.71–4.79 | 52.30–53.27 | 219–238 | 218–236 |
| 256 MiB | Before | 260.50 | 780.37–782.50 | 4796–4879 | 208–230 |
| 256 MiB | After | 4.71–4.80 | 53.08–53.25 | 426–453 | 424–451 |

The first service read becomes more expensive because it creates a consistent disk snapshot. The
frontend becomes usable after one page instead of assembling and decoding the entire file. These are
API text-ready times, not CodeMirror paint times or measured packaged-WebView memory.

| Approximately | Other-project read during open, before → after ms | Other-project write, before → after ms | Next page ms | Page save ms |
|---|---:|---:|---:|---:|
| 128 MiB | 90–96 → 0.74–1.12 | 100–103 → 9.53–11.06 | 0.33–0.63 | 415–445 |
| 256 MiB | 188–213 → 0.57–0.82 | 198–224 → 6.22–10.64 | 0.35–0.46 | 868–940 |

During the new page saves, other-project reads took 0.55–0.84 ms and writes 5.19–11.52 ms; Rust peak
working set through save was 4.88–5.05 MiB. Saving still does whole-file I/O and digest checks. Save
measurements replace the page with identical text to keep repeated samples comparable.

Opening needs one extra logical file-sized snapshot: 134,250,496 or 268,500,992 bytes in these runs.
The complete initial copy/two-scan phase is included in the first-read timings above; copy-only time
was not separately instrumented. While saving, the old snapshot, staged replacement, and new snapshot
can coexist: about three extra file sizes, plus page-size changes, across system-temp and destination
volumes. These are logical file-size requirements verified against the snapshot lifecycle, not measured
physical allocation/free-space deltas. A full disk is simulated with an injected `StorageFull` writer;
the test does not fill the real system disk. Cancellation, staging cleanup after conflict, idle expiry,
and byte-for-byte prefix/suffix preservation have targeted tests.

The earlier code review did not contain a performance benchmark. These measurements do not establish
that a previous build OOM was a runtime leak or caused by Mermaid.

## Verification record

Task evidence is in `.codex-tmp/project-editor/`:

- `full-rust-editor.log` and `full-rust-entries.log`: the real desktop
  `codex_switch_lib_tests` target passed 29/29 editor tests and 5/5 file-entry tests. The editor output
  explicitly includes the continuously appended-log regression. `tested-rust-artifact.json` records
  executable `cc27428d77ff4c5c` with SHA-256
  `0CE41CB9CAD94C3A7F207829CF133E9AC3EC0E733E86DB1CACE83CBBE0137531`;
  `final-rust-source-identity.json` records the matching unchanged service sources.
- `clippy.log`: `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --test
  codex_switch_lib_tests -- -D warnings` passed. `final-fmt.log` records the successful crate format check.
- `rust-harness-tests.log`: 29/29 real-source tests, including binary blame, permissions/path rules,
  UTF-8/CRLF reconstruction, immutable pages, conflicts, cancellation while a save waits for its path
  claim, expiry, and injected disk-full failure.
- `desktop-vitest.log`: 5 files, 28/28 frontend tests, including moved-page drafts and conflict recovery.
- `native-vitest.log`: 10/10 native bridge tests, including page ranges and invalid input.
- `i18n-check.log`: 11 files, 58/58 tests. Original migration fingerprints and corruption assertions
  are retained. Four new resource files were rewritten using explicit UTF-8 after a PowerShell pipeline
  converted non-ASCII literals to question marks; all resources were read back and generated again.
- `native-generated-checks.json`: all six native generated-asset checks passed. Project-browser and
  lounge-document assets are generator outputs; the latter embeds the shared client catalog.
- `shared-build-evidence.json` and `frontend-hash-recheck.json`: Desktop/Web TypeScript and production
  Vite builds, plus native TypeScript, reuse the successful task-2 full hook at
  `.codex-tmp/history-window/commit-check.log` for the earlier 74-source snapshot. The later Android
  UUID compatibility fix changes frontend hashes, so that reuse does not cover the final frontend.
  The final mandatory publication hook runs fresh applicable checks and records them in `commit-check.log`.
- `playwright-final.log`: 8/8 bundled-Chromium scenarios. Three production local/remote/Web entry
  components use the real Rust service for page edits and conflicts; the native offline document uses
  the production bridge and service. Existing large-text/SSH search, replace, undo, and save pass.
- `reviewed-screenshots/`: 22 inspected screenshots. Local/remote/Web desktop states cover initial page,
  unsaved navigation, conflict, and narrow layouts; Web includes 390 px width. The native generated
  offline document covers 390 px width in Chinese, English, Japanese, and Russian. No clipped copy or
  broken Unicode was observed. Screenshots are app-component/embedded-document evidence, not a claim
  of a packaged Tauri shell, live remote network, or physical Android/iOS application run.
- `native-windows-run.log` and `native-windows-results.json`: the isolated Tauri/Wry host passed all
  three local/remote/Web entry scenarios, opening a 256 MiB file and preserving drafts after an
  external-save conflict. Six `native-windows-{mode}-{initial,conflict}.png` screenshots and the
  native-shell screenshot were inspected. This host uses production Rust editor services and real
  WebView2; remote transport is still a local adapter. With unoptimized test dependencies, opening
  took 8.22–8.30 s and conflict validation 8.60–8.63 s. A 25 ms frontend timer had maximum gaps of
  27.7–76 ms during opening and 27.9–29.4 ms during save validation. These observations are separate
  from the release benchmarks above and do not measure native message-loop latency or WebView memory.
- `offline-uuid-vitest.log`: 9/9 transfer/rebind tests after the Android compatibility fix, including
  valid unique UUID v4 tokens without `randomUUID`. `playwright-offline-uuid.log`: all 8 browser scenarios
  passed again; the offline document scenario now explicitly removes `randomUUID` and verifies saving
  through the real service and native bridge. The generated project-browser asset check passed again.
- `android-run-final.log` and `android/result.json`: physical device `f25ca15c` passed page navigation,
  dirty-page save confirmation, retained edits, and return-to-list navigation at font scales 1.0/1.3.
  All eight `android/android-page-*.png` screenshots were inspected: Chinese glyphs and wrapping are
  complete, including the enlarged title, page notice, range, and navigation. This independent
  `com.codexswitch.mobile.filebrowsertest` application uses the production native shell/offline bridge
  with an in-memory file service; it does not claim a real network or Rust service running on Android.
  `android-artifact.json` identifies the tested APK with SHA-256
  `AB33D5B5CA85E750F1CA55DCE4B9D0B3CD92DD40810C29E9A91E6772F00B1980`.
  `android/device-after.json` independently confirms font scale 1.0 was restored, the fixture was removed,
  and the main app remains installed; the runner's cleanup assertions also passed.

Windows file symlink creation was denied (1314), and junction traversal was denied by the OS (448).
The test verifies refusal in this environment and exercises canonical alias contention where the OS
allows traversal; positive symlink-alias locking is still unverified on this host. iOS, macOS/Linux UI,
live remote-network operation, and the installed production-Tauri end-to-end flow remain unverified.
The first independent Wry build failed
because its test builder selected incompatible dependency variants by modification time; production
crate tests and Clippy passed. The corrected builder selects the tested target's exact Cargo fingerprints
and its runtime checks passed. Initial runtime failures (the Vite load timeout and a 5 s conflict
assertion timeout against unoptimized dependencies) are retained separately. Android's first build
failed to resolve Expo from the root CLI; process-local `NODE_PATH` fixed that build without changing
dependencies. The first physical run exposed the missing UUID API and is retained under
`android-uuid-failure/`. Later tooling failures (single-quoted XML attributes and transient drawer
coordinates) are retained under `android-parser-failure/` and `android-launch-failure/`. The runner
now parses both XML quote styles and waits for stable control coordinates; product assertions were
preserved. The final Android run passed with cleanup. Publication uses the unmodified mandatory hook
under the coordinated heavy/Git mutexes; `commit-check.log` and `push.log` record its result separately.
