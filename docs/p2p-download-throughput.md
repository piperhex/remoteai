# P2P download storage throughput

## Fixed receive-window stall

Desktop remote downloads and Web share `shared/downloads/bulkStorage.ts`. The receiver reserves
up to two 1 MiB blocks per peer and retains each reservation until its IndexedDB write completes.
The previous store waited for 4 MiB or 250 ms before committing. Its byte threshold was unreachable
with that request window, so even instant input was limited to about 8 MiB/s. Two files sharing a
window and a final partial block also had to wait for the timer.

The store now queues a commit in a microtask, combining writes already available in that turn.
Transactions remain serialized, and data plus the committed bitmap remain atomic. Writes resolve
only after transaction completion, retaining bounded backpressure on slow storage. Failed writes
do not advance the checkpoint and reject queued writes. Android retains its separate native writer;
local desktop legacy downloads retain their existing path.

## ZH2 VM measurements, 2026-11-16

The source was the installed Remote AI desktop host on the ZH2 Windows virtual machine. The receiver
was bundled Chromium running the actual shared connection, encrypted file protocol, Worker decoder,
block verification and IndexedDB downloader from the workspace. This exercises real P2P traffic,
not a simulated socket. It is not an installed Tauri receiver or an Android hardware measurement.

Each sample downloaded the same 128 MiB random file and verified its whole-file SHA-256 against a
hash computed independently on the VM. Rates cover the downloading phase, including block
decryption, verification and storage; preparation, final whole-file verification and user export are
separate phases. No other builds or tests ran during the three-sample comparisons.

| Receiver storage | Runs (MiB/s) | Mean (MiB/s) | Full-file verification |
| --- | --- | --- | --- |
| Previous store, shared `4c0ed2e` | 4.49, 4.50, 4.46 | 4.48 | 3/3 passed |
| Immediate queued commits | 11.46, 11.56, 11.58 | 11.53 | 3/3 passed |
| Immediate commits, explicit-LAN-candidate experiment | 11.48, 11.52, 11.58 | 11.53 | 3/3 passed |

The measured improvement is about 2.57 times. The selected file DataChannel carried the full
encrypted payload separately from chat. Both candidate endpoints were public mapped addresses
(`srflx`) on the same public IP, with about 5 ms RTT. These results must not be described as a
verified LAN-address path or as the capacity of the 2.5 Gbps physical network.
The explicit-LAN-candidate experiment still selected the same public candidate types and did not
improve throughput. It therefore does not isolate routing as the remaining bottleneck. After the
fix, storage waiting summed to approximately 0.4 seconds per 128 MiB download; the remaining
transport, sender and per-record processing costs need a separate profile before further changes.

Raw address-bearing measurements remain local in `.codex-tmp/p2p-vm-baseline.json` and
`.codex-tmp/p2p-vm-fixed.json`, plus `.codex-tmp/p2p-vm-lan-candidates.json` for the diagnostic run.
Saved credentials and file content are never included in those reports.

## Android emulator follow-up, 2026-11-16

An Android 15 x86_64 emulator subsequently ran the production native connection and Kotlin download
pipeline in an isolated, bundled Hermes test application, with development mode disabled. Three
128 MiB downloads from the same ZH2 source averaged **3.97 MiB/s** (4.04, 3.87 and 4.00). Every exported
Android file matched the independently calculated source SHA-256. A fresh Chromium comparison using
that same file averaged **11.61 MiB/s** (11.55, 11.69 and 11.58).
A later native run on a fresh connection, validating final runner cleanup, measured **2.86 MiB/s**
and also passed both integrity checks. The first session's mean is not a stable throughput ceiling.

This is an emulator measurement, not physical-phone Wi-Fi throughput. Native bulk reported `direct`;
connection diagnostics showed public mapped UDP endpoints, so a LAN-address file path is not proven.
The lower native rate remains unexplained by this measurement alone. Android has its own native
writer and does not use the IndexedDB commit batching fixed above. See the Native repository's
[benchmark details and reproduction instructions](../apps/native/docs/p2p-throughput.md).

## Physical Android and Rust sender follow-up, 2026-11-16

On a physical Xiaomi 2109119BC / Android 15, three clean downloads from the same ZH2 sender improved
from **6.43 to 10.40 MiB/s** after fixing Android UDP receive-buffer overflow. The baseline accumulated
2,653 UDP receive-buffer errors; the fixed three-run session added none and the active file socket had
zero drops. Packet-header observations correlated to the file socket proved a LAN-address path for
these phone tests. See [native measurements and limitations](../apps/native/docs/p2p-throughput.md).

Desktop P2P file payload encryption now runs in Rust. A bounded blocking worker reads and verifies
each 1 MiB block once, retains at most two active blocks, and returns batches of at most sixteen RAB1
authenticated records through binary IPC. JavaScript only forwards ciphertext. The existing per-epoch
directional key is handed off once and the JavaScript cipher is destroyed, preventing parallel nonce
allocation. Rust checks the authorized file handle, manifest, epoch, offset and negotiated record size;
keys and cached plaintext are released on close/expiry. Asynchronous Tauri commands keep file I/O and
encryption off the UI thread. The queue serializes nonce allocation and transmission across concurrent
block requests, retaining replay protection and cancellation checks.

A local optimized release sender using that Rust implementation downloaded to the physical phone at
**10.31, 9.71 and 9.36 MiB/s** (mean **9.79 MiB/s**). All three published files passed independent SHA-256
verification. The source computer differs from ZH2, so this is an interoperability/performance result,
not a controlled encryption-language speedup. The approximately 10 MiB/s ceiling remains unresolved.
Raw TCP from that same local computer achieved 29.64 MiB/s, including sender socket buffering and without
the production protocol; it is not an encrypted application download measurement.

A diagnostic run counted 640 native read/encrypt IPC responses totaling 2.42 seconds for 128 MiB.
The bounded-batch zero-delay timers totaled 0.215 seconds in a separate sample. Neither measurement
alone explains the whole transfer, and overlapping stages cannot simply be added. A larger sender
DataChannel buffer did not establish enough improvement to change the production policy.

Native and browser receivers retain the same wire format. Tests cover an exact existing JavaScript
protocol vector, interleaved blocks, monotonic nonces, scope/offset/size limits, changed source files,
cancelled replies and the absence of JavaScript payload encryption in the desktop sender. The desktop
targeted file-stream suite passed 26 tests, desktop bulk suites passed 18, and Rust Clippy passed.
The final desktop browser regression passed four tests for local/remote downloads, disconnection,
binary relay and native IPC. Web desktop/mobile binary-download regression passed eighteen tests.
Native passed 1,513 unit tests and 46 physical-device instrumentation tests. Desktop and Web production
builds, native type checks, translation checks and shared boundary checks passed.
No interface changes are involved; local desktop files continue to use their filesystem path, and
desktop remote/mobile/desktop Web receivers consume the same authenticated binary records.

## Single-ended isolation, 2026-11-17

Continuous, warmed single-ended tests ruled out a fixed 10 MiB/s capacity in file processing.
The Rust release sender read and SHA-256 verified at **1,545–1,614 MiB/s**, encrypted at
**646–714 MiB/s**, and read, verified and encrypted together at **537–585 MiB/s**.
Each mode had one warm-up and three 512 MiB samples; manifest preparation was outside the timer.
The actual phone decoder, block assembler, SHA-256, storage and 4 MiB durable checkpoints together
achieved **88.52, 89.32 and 89.59 MiB/s** at the production worker's background priority.
These cached, continuous workloads do not reproduce bursty transfer scheduling or CPU power states.

We then removed file crypto, disk I/O, application requests and Rust/WebView IPC, sending three
128 MiB synthetic streams to the same phone's native WebRTC observer. Both engines used ordered
16 KiB records and the production 256/64 KiB high/low send-buffer thresholds.

| Desktop sender runtime / diagnostic | Receiver throughput (MiB/s) |
| --- | --- |
| Bundled Chromium 153 | 24.85, 26.36, 24.30 |
| Desktop WebView2 157, isolated Tauri test | 13.25, 13.08, 13.06 |
| WebView2 with 1 MiB high threshold | 12.24, 13.17, 13.10 |
| WebView2 with an experimental 1 ms script timer | 13.16, 13.31, 13.52 |
| Chromium repeat after the WebView2 tests | 20.68, 23.69, 18.78 |

Selected candidate addresses were the PC's and phone's LAN addresses. The PC's selected candidate
was peer-reflexive with its existing TUN interface as related address, so this does not prove the
VPN adapter was bypassed. ADB reverse carried only signaling and reports. Records were checked for
sequence, size and payload sentinels; this diagnostic is not a saved-file hash test.

WebView2 spent about 9.6–9.8 seconds per sample waiting for transport backpressure, while all 8,192
JavaScript `send` calls totaled only about 21 ms. The runtime-associated difference already exists
before the product pipeline. Larger buffering and a script timer did not resolve it. These tests
isolate the WebView2 transport path as a major bottleneck, but do not distinguish its internal
network scheduling, SCTP implementation, engine-version or process-policy differences. They do not
prove that replacing the transport will achieve Chromium's rate. That requires a native transport
comparison, followed by the complete authenticated product download.

Reproduce Rust stages with the optimized ignored test `single_ended_sender_throughput` in
`apps/desktop/src-tauri/src/codex_gui/file_stream/throughput_benchmark.rs`:

```powershell
cargo test --release --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-default-features `
  single_ended_sender_throughput -- --ignored --nocapture --test-threads=1
```

Build/install the non-debuggable Android instrumentation packages using the
[native stage instructions](../apps/native/docs/p2p-throughput.md). Then run from this repository:

```powershell
node scripts/benchmark-android-data-channel.mjs <serial> <report.json>
# Optional arguments: high threshold KiB, record KiB, existing Rust test executable for WebView2.
node scripts/benchmark-android-data-channel.mjs <serial> <report.json> 256 16 <Rust-test-executable>
```

The WebView2 option runs only `provider_browser::automation::tests::opens_conversation_browser`,
whose isolated builder does not register application helpers or start the production app. Do not
substitute the full desktop executable. Browser flags use `scripts/test-browser.mjs`. The runner
closes its test browser, removes its ADB reverse and isolated WebView2 profile on exit. The timer
experiment is opt-in through `P2P_BENCH_PULSE_TIMER=1`; it is not a product change.
Local reports are in `.codex-tmp/p2p-phone/`: `rust-stages.log`, `native-stages.json`,
`channel-256.json`, `channel-webview-256.json`, `channel-webview-1024.json`,
`channel-webview-pulse.json` and `channel-chromium-repeat.json`.

## Native desktop RTC migration and the in-flight window

The desktop chat, lounge, file and remote-desktop receivers now inject the native Rust peer.
Desktop capture already uses the native sender; the obsolete browser capture/RTC fallback was removed.
Web retains browser RTC. Browser-based simulated senders used by Web integration tests live only in
Web's `e2e/rtc-host/` directory. WebCodecs and WebAudio present decoded video/audio in the desktop
view; Rust owns ICE, DTLS, SCTP, RTP reordering/depacketization and RTCP.

Replacing WebView2 with webrtc-rs alone was insufficient: the initial native raw-channel runs were
10.51, 10.29 and 10.55 MiB/s. Inspection of webrtc-sctp 0.17.2 confirmed that `buffered_amount`
is released when bytes are acknowledged. Applying the browser's 256/64 KiB thresholds therefore
restricted native in-flight bytes and repeatedly drained the sending window. Only the native file
channel now uses 1 MiB high / 768 KiB low thresholds. Interactive channels retain 256/64 KiB.
Desktop receive IPC batches up to 32 packets / roughly 256 KiB per response, preserving boundaries.
Native encrypted sends go directly from the file worker to SCTP, without ciphertext returning to JS.

Physical phone comparisons on 2026-11-17 used three 128 MiB random-file runs per group:

| Diagnostic path | MiB/s per run | Mean |
| --- | --- | --- |
| Rust production read/encrypt -> native SCTP -> Android decrypt/hash/durable storage, 256/64 KiB | 13.76, 13.35, 13.09 | 13.40 |
| Same stages, 1024/768 KiB, before the control group | 18.55, 22.85, 22.37 | 21.26 |
| Same stages, 1024/768 KiB, after the control group | 18.27, 16.75, 17.08 | 17.37 |
| Actual desktop NativeBulkSender + Tauri direct-send command + the same Android stages | 18.04, 17.65, 27.43 | 21.04 |

The native IPC path already yields asynchronously, so its extra per-batch zero-delay WebView timer
was removed. An alternating comparison through the actual desktop sender measured:

| Desktop batch scheduling | MiB/s per run | Mean |
| --- | --- | --- |
| Native IPC without extra timer, first group | 14.65, 22.15, 27.89 | 21.56 |
| Extra timer restored in the diagnostic only | 14.22, 19.35, 21.70 | 18.43 |
| Native IPC without extra timer, repeat group | 19.49, 28.60, 18.55 | 22.21 |

All nine files verified. Both timer-free means improved, but individual runs overlap; do not treat
the observed timer cost as a constant. Non-native/relay scheduling retains its existing yielding.
Set `P2P_BENCH_YIELD_BATCHES=1` only to reproduce the timer control group. This also avoids relying
on background WebView timers for native file pacing; asynchronous native backpressure remains bounded.

All final saved-file SHA-256 checks passed. Rust file read/hash/encryption workers consumed about
0.28–0.31 seconds per transfer, compared with roughly 5–10 seconds for transport and storage.
Wireless variation remains substantial; the evidence supports a bounded-window bottleneck and
an improvement, not a fixed promised LAN rate. The receiver's bounded 4 MiB diagnostic queue waits
when full; it never grows to hold the complete file. Cold-start queuing initially exceeded a nonblocking
queue, so results above use bounded backpressure.

These are controlled pipeline diagnostics. They use an explicit public test key and temporary
file authorization, omitting the separately tested account handshake, manifest preparation and
production download-control credit negotiation. Receiver rates exclude the final full-file reread;
sender times include the verified completion reply. Do not label them authenticated product-download
benchmarks or directly compare different source machines as a language speedup.

The isolated desktop media test verifies real native peers, 2 MiB ordered file records, chat echo,
H.264/HEVC 640 × 360 decoded video, Opus signal RMS and teardown/reopen while rejecting every browser
RTCPeerConnection constructor. Windows HEVC presentation supplies the SPS coded size and applies the
conformance crop, avoiding default upscaling and padded output. Independent HEVC fixture RTP covers
IDR_N_LP/CRA because the upstream sample payloader does not packetize those ffmpeg outputs correctly.

To repeat native pipeline measurements, build the optimized application test target with
`--release --no-default-features --lib --no-run`, install the Native download instrumentation APKs,
and use the resulting test executable:

```powershell
$env:P2P_BENCH_RUST='1'
$env:P2P_BENCH_ENCRYPTED='1'
$env:P2P_BENCH_LOW_KIB='768'
node scripts/benchmark-android-data-channel.mjs <serial> <report.json> 1024 16 <release-test-executable>
```

For the actual desktop IPC path, start `npx vite --config scripts/vite.native-rtc.config.ts` in
`apps/desktop`, set `P2P_BENCH_NATIVE_APP=1`, and use the same runner. This option uses the isolated
native RTC builder, not full application startup. It creates and removes its own random fixture,
ADB reverse and WebView profile. Do not run builds or other transfers during speed measurements.
The fast `apps/desktop/scripts/native-rtc-benchmark` target supports raw transport diagnostics only.
Validation after migration passed the desktop/Native/Web builds and checks, Native's 1,513 unit tests,
42 Web download tests, 16 Web media tests, four desktop local/remote/IPC download tests, native media
and channel smoke tests, and Clippy with warnings denied for the application and tests. Four optional
Web TURN upgrade/standby scenarios skipped because their external relay fixture was not configured.
The parent Rust suite passed 2,945 tests with no failures (40 manual/environment-dependent tests ignored).
Local RTC state-machine tests use IPv4 loopback peers while retaining real DTLS/SCTP exchanges;
this isolates them from machine-specific interface routing without changing production ICE settings.
The previously intermittent standby-promotion test passed 30 consecutive runs with this fixture.

## Repeating the comparison

Create a disposable source file on an explicitly selected, signed-in test computer and independently
compute its SHA-256. The benchmark uses the saved account's normal authenticated file authorization,
host identity validation and server policy. It does not enable bulk or bypass unavailable P2P.

```powershell
node scripts/p2p-download-benchmark.mjs `
  --device <device-id> --file <remote-test-file> --sha256 <expected-sha256> `
  --server <server-url> --auth-file <saved-cloud-auth.json> `
  --runs 3 --output .codex-tmp/p2p-current.json
```

Add `--baseline-ref 4c0ed2e` and a different output filename to load only the previous storage and
limit modules from the shared Git history. The rest of the receiver and the remote source stay the
same. The script binds its harness to loopback, uses the guarded bundled test browser, deletes its
download cache, and closes its browser and server when finished. Delete the disposable source file
after all runs. The credentials file is read locally and its access token is used in memory only.

`--expose-lan-candidates` is a separate diagnostic experiment in the disposable test browser. It
disables Chromium's mDNS host-address substitution for that browser process only; record the selected
candidate pair to establish whether this actually changed the route. It changes neither product
defaults nor the user's browser settings. Chromium describes the feature in its
[feature definition](https://chromium.googlesource.com/chromium/src.git/+/88c928788852dad1fa6cdd43a2560dcda5d9b2b1/third_party/blink/common/features.cc).

## Validation

- Six new storage tests cover immediate partial-block commits, a full window, two files sharing a
  window, slow-transaction backpressure, storage failure and closing a queued write.
- Related desktop unit suites: 32 tests passed; desktop test type checking passed.
- Desktop browser regression: four tests passed, covering local/remote management, disconnect,
  binary relay and a 32 MiB native-adapter transfer with pause/resume and exact saved content.
- Web desktop/mobile binary-download regression: 16 tests passed, including corruption, reload,
  checkpoints, path changes, failed saves and legacy migration.
- Desktop and Web production builds, shared boundaries, parent i18n checks and Native checks passed.
- Web dependency snapshots were refreshed with `npm run export:web` and independently verified.
