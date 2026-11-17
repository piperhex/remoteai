# Native desktop chat and conversation synchronization

## Scope

Desktop chat session key agreement, HKDF, ChaCha20-Poly1305, compression and replay checks run
in Rust. The TCP fallback's handshake proofs, per-socket keys, directional nonces and outer
encryption also run in Rust. Native failures do not trigger a JavaScript crypto fallback.
Browser clients retain the compatible shared implementation; Android retains its native packet
codec. This change does not migrate unrelated features such as port-forwarding stream encryption.
On a selected native RTC path, chat batches are encrypted and submitted directly in Rust; ciphertext
does not return to JavaScript before sending. Nested multipath envelopes retain their original wire
format. Relay and TCP paths retain native crypto with the existing compatible frontend adapters.

Conversation archive transfers between capable desktop peers use a negotiated, ordered
`remote-ai-sync-v1` DataChannel (ID 43). Rust reads the authorized bundle, encrypts binary records,
sends them, decrypts incoming records, writes checkpoints and verifies the final SHA-256.
Archive payloads do not pass through JavaScript, JSON/base64 RPC or WebView IPC. The coordinating
desktop can also decrypt and re-encrypt a bounded stream between two remote computers in Rust.
RPC still handles authorization, startup, progress and cancellation.

Both bundle endpoints must advertise binary version 1 and expose an open native channel.
Old peers, Web/mobile coordinators, TCP-only connections and relay transfers retain compatible
RPC transfer behavior. Relay quotas are unchanged. Local-to-local moves retain the existing path.
Desktop local and remote synchronization entry points inject the same transport adapter.

## Bounds and integrity

- At most 16 synchronization jobs, 8 inboxes per peer and 128 queued records per inbox.
- Authenticated records are at most 16 KiB and bind the transfer ID, direction, offset and sequence.
- A 1 MiB durable batch is acknowledged after data flush and checkpoint persistence. The final
  acknowledgement follows whole-file SHA-256 verification. Progress represents acknowledged bytes.
- Cancellation drains an in-progress blocking write before returning, so a resumed transfer cannot
  race the previous writer. Session release revokes job ownership and closes active jobs.
- The frontend can pass registered bundle capabilities, not arbitrary file paths. Remote job
  requests are scoped to their authenticated connection and cannot substitute another native peer.
- Crypto runs on blocking workers with bounded sessions, batches and outstanding operations.

## Bottlenecks found

The legacy archive path splits base64 RPC messages into 2,400-character chat fragments and hex
encodes encrypted packets. That adds serialization, expansion, acknowledgement and cross-language
work for every fragment. Moving AEAD alone does not remove those costs.

The first native crypto adapter froze its next batch in a microtask before the preceding IPC call
completed. Because the producer yields between fragments, it effectively created one IPC call per
packet. A 1 MiB diagnostic sample made 1,700 single-packet batches and achieved 0.595 MiB/s.
The corrected drain takes the next batch after the previous IPC completes, allowing arrivals to
coalesce without a timer. The same small diagnostic reached 2.112 MiB/s, with batches up to 19
packets. Reservations now reflect each fragment's bounded wire size instead of charging every
fragment the maximum packet size. A regression test covers arrivals during an in-flight IPC call.

The first physical-phone comparison found another regression: returning Rust ciphertext to JS and
then submitting it to Rust RTC achieved 4.85–5.24 MiB/s, versus 5.98–6.55 MiB/s for JS encryption.
Across each approximately 31.3 MiB run, crypto/IPC waiting rose to 1.53–1.64 seconds, while JS crypto
took 0.22–0.24 seconds. Native crypto reduced synchronous frontend submission from up to 7.1 ms to
0.1–0.2 ms, but that alone did not improve throughput. Direct native submission removes that extra
ciphertext round trip. The original measurements are retained rather than discarded.

## Measurement method

The PC comparison uses an optimized isolated Tauri test executable, two real Rust WebRTC peers,
the actual ChatLink/RPC implementations and native bundle services. It uses IPv4 loopback to
isolate software overhead, three fresh 32 MiB random bundles per mode, and final hash validation.
Archive export/import preparation is excluded. Legacy transfer timing includes a final hash check;
native binary timing includes durable acknowledgements and final verification. The native case
asserts zero payload read/write RPC calls. Account authentication is replaced by temporary fixture
capabilities. These numbers are not physical LAN capacity or an installed-app end-to-end benchmark.

The phone comparison sends three sets of 2,048 approximately 16 KiB chat plaintexts through the
desktop Rust WebRTC transport to a physical Android device. It compares JS and batched Rust
desktop crypto with the same Android `PacketCipher`. The receiver validates every plaintext and
reports decode/decrypt time. The sender reports encryption/IPC time and event-loop delay.
For direct native submission, the operation time also includes native transport backpressure;
it must not be interpreted as time spent only on encryption.
ADB reverse carries only setup and reports; WebRTC payloads use the selected ICE path. This test
isolates chat packet handling and excludes account login, chat rendering and conversation import.

The debug smoke tests validate compatibility only; their rates must not be compared with release
measurements. Builds and unrelated test jobs must finish before timed comparisons.

## Final PC comparison, 2026-11-17

| Archive transport | Runs, useful MiB/s | Median MiB/s | Payload RPC calls per run |
| --- | --- | --- | --- |
| Original JS crypto and RPC | 0.762, 0.747, 0.763 | 0.762 | 256 |
| Rust crypto/direct submission, compatible RPC framing | 2.968, 3.025, 3.178 | 3.025 | 256 |
| Rust binary archive stream | 25.494, 23.376, 23.557 | 23.557 | 0 |

All nine 32 MiB transfers passed whole-file validation. Median improvements over the original
path are approximately 4.0 times for compatible RPC and 30.9 times for the binary stream.
The binary runs recorded 1.0–1.4 ms maximum event-loop delay; the original RPC runs recorded
29.8–52.3 ms. The binary rate includes durable batch acknowledgement and final file verification.
This remains a same-PC loopback comparison; it is deliberately separate from the phone LAN test.

The final report is `.codex-tmp/chat-sync-direct-final.json`. Earlier measured stages are retained
in `.codex-tmp/chat-sync-release-baseline.json`, `.codex-tmp/chat-sync-final.json`, and the small
`.codex-tmp/chat-sync-rpc-batching-before.json` / `chat-sync-rpc-batching-after.json` diagnostics.

## Physical Android result, 2026-11-17

An Android 15 Xiaomi 2109119BC received the plaintext through the actual Android packet codec.
Both final runs selected host ICE candidates on the same LAN. Each sample validated all 2,048
messages (32,781,226 plaintext bytes). No account session, production installation or user history
was used. The isolated test packages were used instead of replacing the installed app.

| Desktop path | Runs, useful MiB/s | Median MiB/s | All plaintexts |
| --- | --- | --- | --- |
| JS encryption, Rust RTC | 6.957, 6.447, 6.717 | 6.717 | Verified |
| Rust encryption and direct Rust RTC submission | 6.863, 7.243, 7.329 | 7.243 | Verified |

The final median improvement is about 7.8%, with some run-to-run overlap. This is a modest
throughput improvement, not a claim of reaching Wi-Fi capacity. Synchronous desktop batch
submission fell from 2.3–6.1 ms to 0.1–0.2 ms. Android decode/decrypt/UTF-8 work still consumed
2.26–2.53 seconds in each approximately 4.3–4.6 second native-send run. That aggregate timer does
not separate hex decoding from AEAD, allocations or UTF-8 conversion. The compatible text wire
format also carries approximately twice as many ciphertext bytes as useful plaintext bytes.

Raw reports are `.codex-tmp/chat-phone-js-direct-comparison.json` and
`.codex-tmp/chat-phone-rust-direct-final.json`. The pre-fix native round-trip comparison is retained
in `.codex-tmp/chat-phone-js-final.json` and `.codex-tmp/chat-phone-rust-final.json`.

## Validation scope

The subsequent Android-only profiling and strict hex-decoder optimization are documented in
[Native local packet profiling](../apps/native/docs/android-packet-throughput.md). Local 16,000-byte
packet processing improved from 25.62 to 85.62 MiB/s, while the foreground LAN A/B stayed around
8 MiB/s. Receiver decode/decrypt time fell from 2.092 to 0.968 seconds; this does not establish a
corresponding end-to-end throughput improvement.

A further [LAN sending-window investigation](chat-lan-window.md) identified native SCTP backpressure
as a material limit. The selected 512/384 KiB chat window improved the two alternating comparisons
from 7.87 to 11.76 MiB/s and 7.17 to 11.35 MiB/s, while preserving the existing encrypted wire format.
That report includes rejected window/batch experiments and separate sender/receiver timing definitions.

Validation includes native wire vectors, tamper/replay rejection, per-socket TCP keys, ownership,
late cancellation, IPC batch coalescing, selected-path wrapper depth, real Rust RTC transfer and
bridge/resume/file hash tests. Desktop local and remote synchronization browser fixtures pass.
Desktop and Web production builds, Native type checks/tests, shared boundaries, localization
ownership and Rust Clippy are checked. No UI behavior or typography was changed.

The historical `hot-chat.pw.ts` browser suite cannot start because it still imports the removed
NestJS `apps/admin/dist/modules/devices/chat/chat-sessions.js`. It is not counted as passing:
current protocol unit tests and isolated native interoperability runs provide the transport evidence.
The fixture measurements do not prove a full account-authenticated installed-app workflow or a
completed production release. Web/mobile retain their existing compatible transports; only capable
desktop peers use the new binary archive path.

## Reproduction

Start the isolated Vite fixture in `apps/desktop`:

```powershell
npx vite --config scripts/vite.native-rtc.config.ts --host 127.0.0.1
```

Build and run from the repository root. Use the actual executable path printed by Cargo:

```powershell
cargo test --release --no-default-features --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --no-run
node apps/desktop/scripts/benchmark-chat-sync.mjs <test-executable> .codex-tmp/chat-sync-final.json 32 3
```

The comparison also validates the Rust TCP codec against an unmodified JS peer in both roles,
including fragmented frame headers and bidirectional Unicode messages. A separate 1 MiB check
exercises two nested multipath envelopes over real Rust RTC before the timed comparisons.

Build the isolated Android instrumentation APKs from `apps/native/android`, then install both
`app-debug.apk` and `app-debug-androidTest.apk` from `app/build-download-throughput/outputs/apk/`:

```powershell
.\gradlew.bat -I ../e2e/downloads.init.gradle -I ../scripts/download-throughput.init.gradle `
  :app:assembleDebug :app:assembleDebugAndroidTest -PreactNativeArchitectures=arm64-v8a
```

Run the phone comparison from the root, once per crypto mode:

```powershell
$env:PATH = "$env:ANDROID_HOME/platform-tools;$env:PATH"
$env:P2P_BENCH_CHAT = '1'
$env:P2P_BENCH_CHAT_CRYPTO = 'js' # Repeat with 'rust'.
node scripts/benchmark-android-data-channel.mjs <serial> .codex-tmp/chat-phone-js.json 256 16 <test-executable>
```

Do not set `NATIVE_RTC_TEST_LOOPBACK` for a phone run. Do not launch the complete desktop application
as a benchmark harness: the isolated `native_rtc::harness::opens_native_rtc` test avoids modifying
installed helper registrations. Remove the two isolated `com.codexswitch.mobile.downloadtest`
packages after testing; the normal installed application is not replaced.
