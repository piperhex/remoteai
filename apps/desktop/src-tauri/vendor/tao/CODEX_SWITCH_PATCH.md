This is Tao 0.35.3 from crates.io, licensed under Apache-2.0 (see `LICENSE`).
Original crate checksum: `d1c93047acf68669466a34690ac58cca7010bd1b201e1ec86f1fd0a75d3dd4a9`.

Backported upstream fix:
[tauri-apps/tao#1215](https://github.com/tauri-apps/tao/pull/1215),
commit [`c704261c519c58cfdd0bc2d58ba24e06a0b71c92`](https://github.com/tauri-apps/tao/commit/c704261c519c58cfdd0bc2d58ba24e06a0b71c92).
The application currently uses tauri-runtime-wry's Tao `^0.35.0` dependency;
the fix was not published in that compatible release series.

Two dumps of RemoteAI 1.7.43 on Windows 10, taken over 14 minutes apart,
showed the UI thread handling Shift `WM_KEYUP` while holding
`KEY_EVENT_BUILDERS`. Its call to `PeekMessageW` dispatched a sent
`WM_KILLFOCUS`, recursively entering the same window procedure and waiting
forever for that mutex. Keyboard layout and IME window-state locks had the
same risk. A keyboard-only message filter does not prevent dispatch of sent
nonqueued focus messages.

The backport changes only four Windows source files:

- `event_loop.rs`: peek before locking keyboard/IME state; pass the snapshot
  into the input handlers.
- `keyboard.rs`: consume that snapshot, read key state before acquiring the
  layout-cache lock, and shorten layout lock scopes.
- `keyboard_layout.rs`: expose the upstream modifier helper.
- `minimal_ime.rs`: consume the character-lookahead snapshot without pumping
  messages while window state is locked.

The backport also adds a safety comment for the moved Win32 call.
The normalized Cargo manifest omits unused examples and their development dependencies.
The upstream formatting configuration is included without its nightly-only
import grouping option so the vendored source can be checked with stable rustfmt.

`../../tests/windows_input_reentrancy.rs` exercises real hidden Tao windows
using the exact dependency selected by the application. A second thread queues
`WM_KILLFOCUS` during key-down/up and character handling. A thread-local
`WH_GETMESSAGE` hook also queues it between keyboard and IME lookahead to test
the separate IME lock. Assertions require actual nested delivery, successful
completion, and intact key/text events (including UTF-16 surrogate pairs and
Chinese IME text). Each scenario runs in a child process with a 20-second
deadline so a regression fails instead of hanging the test runner.
As negative controls, the same fixture with unmodified Tao 0.35.3 reproduced
both the Shift-release deadlock and the separate IME reentry deadlock.
All eight patched scenarios also passed on the affected Windows 10 18363 VM
inside its RDP session, using an isolated fixture executable; the installed
RemoteAI process was not replaced or restarted for that check.

Run from the repository root on Windows:

```powershell
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --test windows_input_reentrancy
```

This integration target also runs in the existing desktop Rust checks and
release CI, including nextest. Remove this patch when Tauri accepts a released
Tao version containing the fix and that version passes the same regression
tests. Do not replace the mutex with a reentrant mutex or skip input events;
neither addresses all shared state protected across message pumping.

## Maximized windows entering fullscreen

Windows can retain the maximized state when a borderless window enters fullscreen.
In `event_loop.rs`, the `WM_NCCALCSIZE` handler reserves the taskbar work area
only outside fullscreen. WebView2 then receives the full monitor bounds during
video playback and the maximized work area again on exit.

`../../tests/windows_fullscreen.rs` checks the transition against the current
monitor's physical size and position. Keep this fix until the same regression
test passes with the replacement Tao version.
