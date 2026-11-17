# Chat LAN sending-window investigation, 2026-11-17

## Finding and selected change

The native desktop chat channel's 256/64 KiB high/low watermarks repeatedly drained most of the
in-flight window before admitting more data. `webrtc-sctp` releases `buffered_amount` after peer
acknowledgements, so this bounds in-flight bytes as well as unsent bytes. The compatible chat format
hex-encodes ciphertext: a 16,000-byte plaintext packet occupies roughly 32,000 wire bytes. Only about
eight such packets fit within the old high watermark.

The selected production policy is **512 KiB high / 384 KiB low for `codex-chat-v1`**. It gives the
sender more room and replenishes before most of the in-flight data drains. File and binary archive
channels retain 1024/768 KiB; remote-desktop controls/clipboard retain 256/64 KiB. Encryption,
authentication, ordering, close handling, packet limits and the public wire format are unchanged.
The memory budget remains bounded; a larger 1 MiB chat window was tested and rejected for unstable results.

The two 16-packet-batch comparisons, with opposite run ordering, measured median useful throughput
of 7.87 to 11.76 MiB/s and 7.17 to 11.35 MiB/s. Across their six samples per policy, the combined median
was **7.69 to 11.76 MiB/s**, approximately **53% higher**. These are controlled encrypted packet
pipeline measurements, not a full account-authenticated chat/history synchronization benchmark or
a guarantee of Wi-Fi capacity.

## Test conditions

- Same physical Android 15 Xiaomi 2109119BC, foreground idle test Activity, current optimized Android
  packet decoder, no performance hints or CPU-affinity/power changes.
- Optimized Rust desktop test executable, real `DesktopSessionCipher` batching/direct native sends,
  real DTLS/SCTP, and the production Android authenticated packet decoder.
- Each sample: 2,048 distinct packets, 32,781,226 useful plaintext bytes, 65,677,140 hex ciphertext bytes.
  The public synthetic fixture key and uncompressed ASCII template are independent of user accounts.
- Every plaintext is checked exactly. Source generation, key setup, signaling, readiness, diagnostic
  reset/readout and artifact hashing are outside the data-transfer timer.
- Six alternating runs share one connection per comparison. The reverse-order confirmation starts
  with the new policy on a fresh connection. All recorded nominated routes used host candidates at
  both ends. ADB reverse carries signaling/results only; payloads traverse the LAN.
- Benchmarks ran sequentially after this task's build/test processes finished, without screenshot
  capture during timing. Rates count useful plaintext using 1 MiB = 1,048,576 bytes. Other system
  background activity was not controlled; wireless and CPU scheduling variation remains visible.

## Window sweep and confirmation

Each group contains all three original-policy and all three candidate-policy samples, in run order.
Except for the last row, the producer submits 16 packets at a time, matching the previous benchmark.

| Candidate high/low KiB | Original runs, MiB/s | Candidate runs, MiB/s | Original median | Candidate median |
| --- | --- | --- | ---: | ---: |
| 256/192 | 7.94, 7.66, 8.13 | 10.43, 10.34, 9.45 | 7.94 | 10.34 |
| 1024/768 | 8.09, 8.30, 8.26 | 6.53, 10.85, 7.21 | 8.26 | 7.21 |
| 512/384 | 7.51, 8.11, 7.87 | 11.76, 12.56, 11.76 | 7.87 | 11.76 |
| 512/384, reversed order | 7.91, 7.17, 6.96 | 11.35, 10.34, 12.05 | 7.17 | 11.35 |
| 512/384, 64-packet batches | 7.31, 7.14, 7.50 | 10.45, 10.16, 10.05 | 7.31 | 10.16 |

Changing only the low watermark improved throughput without increasing the cap. The 512/384 policy
improved it further and retained a benefit with reversed order and larger producer batches. The
64-packet batch experiment did not establish an additional improvement, so production batching was
not changed. A 1 MiB window shifted waiting into the underlying RTC send and sometimes filled the
Android diagnostic queue; these observations do not establish the exact cause of those stalls.

## Stage evidence

For the first 512/384 comparison, three-run medians were:

| Stage | Original 256/64 | Selected 512/384 |
| --- | ---: | ---: |
| Desktop application-window waiting | 2,943.93 ms | 1,097.42 ms |
| Desktop RTC send call | 69.84 ms | 604.69 ms |
| Android worker waiting for the next packet | 2,830.64 ms | 1,646.22 ms |
| Android packet decode/decrypt | 1,001.42 ms | 815.55 ms |

Original send-lock acquisition totaled about 0.14 ms, excluding it as the material bottleneck here.
The Android sampled queue depth stayed at 10-16 in the selected first group, below its 64-packet bound;
the reverse-order selected group peaked at 33. The receiver still has substantial idle time.

`submitMs` replaces the misleading historical `encryptMs` name: it includes asynchronous command
completion and sending backpressure, not just encryption. Test-only Rust counters separately record
outgoing-lock acquisition (`lockMs`), application-window waits (`windowMs`) and the underlying
`RTCDataChannel::send_text` call (`ioMs`). The latter may include internal transport waiting, so it
must not be described as pure CPU or socket-write time. Counters are compiled out of production.

Android `queueIdleMs` excludes the initial wait for the first packet. `wireDecodeMs` measures text
decoding in the DataChannel callback; `decryptMs`, `decryptCpuMs` and `validationMs` describe the
worker. Callback and worker stages overlap, so their timings cannot all be added into one serial
timeline. `maxQueued` samples the bounded queue after each take rather than claiming an exact peak.

## Compiled default and small-message verification

After rebuilding the optimized executable with the selected production policy, the fixture left
watermarks untouched (`chatProductionWindow: true`, sample `window: null`). Three unprobed transfers
measured **12.76, 12.49 and 13.83 MiB/s**, median **12.76 MiB/s**. All 6,144 plaintexts matched.
These new-connection runs confirm the default policy; they are not paired with the earlier baseline
and must not be used to inflate the approximately 53% paired comparison.

A separate six-run alternating comparison inserted 15 authenticated small probes per transfer:

| Policy | Validated probes | Round-trip p50 | Round-trip p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Original 256/64 KiB | 45 | 12.7 ms | 19.1 ms | 22.1 ms |
| Selected 512/384 KiB | 45 | 16.6 ms | 22.9 ms | 23.7 ms |

This showed about 4 ms additional small-message latency under the tested load. Probe timing includes
encryption, command submission, ordered transport, Android processing and the response poll; it is
not pure network RTT or a full application UI responsiveness measurement. Each probe is sent after
a 16-packet batch, and the sender waits for its reply before continuing. The corresponding transfer
rates are deliberately excluded from the primary unprobed throughput tables.

Final measured executable SHA-256:
`cba5f0c94ebfa6f6a9356f46ba4042b4f23243bf27ca032671763d7e5989fc66`.
Production channel source SHA-256:
`e331dbf255bd945d3b527347817920d3664a6653e76a9bb9d266dbae5850eb70`.
Android instrumentation APK SHA-256:
`799c5d6a7fec349c8a9f42e01ae72e443860e39e95062b5a7b47fbcb179669ec`.

## Reproduction

Build the optimized isolated RTC test executable and start the Vite fixture using
[chat synchronization throughput instructions](chat-sync-throughput.md). Build/install both isolated
Android APKs using [Native packet profiling instructions](../apps/native/docs/android-packet-throughput.md).
Use the latest fixture executable and Android instrumentation APK: the stage counters and optional
latency probes are test-only APIs. Do not launch the complete desktop application for these tests.

Run from the parent checkout, after build/test processes finish:

```powershell
$env:PATH = "$env:ANDROID_HOME/platform-tools;$env:PATH"
$env:P2P_BENCH_CHAT = '1'
$env:P2P_BENCH_CHAT_CRYPTO = 'rust'
$env:P2P_BENCH_CHAT_COMPARE = '0'
$env:P2P_BENCH_CHAT_LEGACY = '0'
$env:P2P_BENCH_CHAT_HINT = '0'
$env:P2P_BENCH_CHAT_FOREGROUND = '1'
$env:P2P_BENCH_CHAT_WINDOW_COMPARE = '1'
$env:P2P_BENCH_CHAT_WINDOW_REVERSE = '0' # Repeat with 1 on a new connection.
$env:P2P_BENCH_CHAT_PRODUCTION_WINDOW = '0'
$env:P2P_BENCH_CHAT_PROBE = '0'
$env:P2P_BENCH_CHAT_BATCH = '16'
$env:P2P_BENCH_LOW_KIB = '384'
$env:P2P_BENCH_NATIVE_APP = '0'
$env:P2P_BENCH_RUST = '0'
Remove-Item Env:NATIVE_RTC_TEST_LOOPBACK -ErrorAction SilentlyContinue
node scripts/benchmark-android-data-channel.mjs <serial> <report.json> 512 16 <release-test-executable>
```

For default-policy verification, set `P2P_BENCH_CHAT_WINDOW_COMPARE=0` and
`P2P_BENCH_CHAT_PRODUCTION_WINDOW=1`. The fixture then leaves the channel's compiled watermarks
untouched; each sample records `window: null`. Do not combine production-window mode with a window A/B.
For latency checks, use `P2P_BENCH_CHAT_PROBE=1` with Rust crypto and a batch size dividing 128.
This inserts 15 authenticated small probes per sample and records their complete round trips in
`probeMs`. The receiver checks each probe identity and count. The sender awaits each reply before
continuing, so probe-enabled transfer rates must be kept separate from unprobed throughput figures.

The runner closes the isolated desktop harness and removes its ADB reverse rule. After all runs,
uninstall only `com.codexswitch.mobile.downloadtest.test` and `com.codexswitch.mobile.downloadtest`,
then stop the task's Vite fixture. The normal installed Android app is independent.

## Reports and scope

Raw local reports under `.codex-tmp/` can contain network addresses and are not committed:

- `chat-lan-window-256-192.json`, `chat-lan-window-1024-768.json`: window sweep.
- `chat-lan-window-512-384.json`, `chat-lan-window-512-reverse.json`: selected policy A/B and confirmation.
- `chat-lan-window-512-batch64.json`: producer-batch diagnostic.
- `chat-lan-production-final.json`: rebuilt executable with untouched production defaults.
- `chat-lan-probes-final.json`: separate latency comparison with 90 verified probes.

The final runner records SHA-256 of the local test executable, production channel source and Android
app/test APK artifacts after measurement. Reinstall the matching APKs before reproducing results.
The new Rust ordered-burst regression sends more than one window of text, checks every record,
checks a subsequent small message and rejects sending after close. Window-budget checks cover chat,
file/archive and remote controls independently.

Desktop local and remote modes use the same Rust channel implementation. Browser Web and Android
retain their transport implementations and wire format; this is a desktop Rust backpressure policy
change, requiring no browser UI or mobile protocol adaptation. The fixtures omit the account handshake,
React Native bridge/UI, conversation storage and full history application. Remaining network/internal
transport waiting and hex expansion limit the conclusions; no claim is made that all LAN bottlenecks
or full installed-app synchronization performance have been resolved.

Validation passed optimized desktop fixture and Android APK builds, nine physical-device crypto
tests, seven Rust RTC tests (two manual fixtures ignored), 24 desktop adapter/crypto/backpressure
tests, desktop test type checking, 1,513 Native tests, Native checks/i18n, and Clippy with warnings
denied for all Rust targets. The normal parent commit hook also runs the complete integration checks.
