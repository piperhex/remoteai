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
