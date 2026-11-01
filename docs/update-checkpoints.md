# Durable package download checkpoints

The block protocol remains 512 KiB with per-block digest checks, HTTP range validation,
multi-source scheduling, and the existing final upstream SHA-256/signature verifier.
This change affects the host's update/dependency package cache, including packages it
downloads for other devices. Browser-managed downloads do not use this filesystem ledger.
No UI, copy, IPC payload, or wire-format change is required.

Local update checks wrap the updater with `enablePeerDownload`. The authenticated remote
update bridge forwards to the main window and uses the same `downloadAvailableUpdate`
adapter. The web client can trigger that host path; its own web-asset update remains
browser-managed. Existing local/download/remote-service adapter tests passed 26 tests
across three files (single Vitest worker). No live cross-machine installation was performed.

## Persistence contract

- A dedicated writer owns the partial file. One semaphore permit travels with each
  command until execution ends, so cancellation cannot enqueue unbounded payloads.
  No file I/O, hashing, fsync, or file lock runs on the Windows UI thread.
- Received blocks can advance live download progress. Only the ledger on disk is used
  to restore progress after a restart. These are intentionally different states.
- Commit after 8 MiB of pending complete blocks or 2 seconds since the first pending
  write. The worker uses a receive timeout: a stalled network needs no additional block
  to trigger the time threshold. Filesystem stalls can extend the wall-clock interval.
- Order: complete data writes, partial file `sync_all` (including its length), serialize
  ledger to a temporary file in the same directory, temporary file `sync_all`, replace
  the ledger. Pending state clears only after the replacement operation succeeds.
- Unix persists the replacement's directory entry with directory `sync_all`.
  Windows clears the temporary attribute and uses same-directory
  `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)`, with no cross-volume copy fallback.
  Never delete the old ledger before replacement.
- Completed block slots are immutable within an attempt, including endgame duplicates.
  Exclusive file locks prevent overlapping writers and pruning of an active partial.
- Resume accepts only the selected artifact's size and ledger shape, then rereads and
  hashes every advertised block. Missing/oversized/truncated JSON, wrong-size partials,
  and digest mismatches cause affected ranges to be downloaded again. Orphan temporary
  files are never treated as progress. The old JSON format remains readable.

## Lifecycle boundaries

| Boundary | Behavior |
| --- | --- |
| Explicit pause/error return | Await flush of accepted complete blocks. Flush errors are logged; old durable progress remains usable. |
| Future cancellation, transfer timeout, policy scope change | Dropping the checkpoint sends Close to its existing writer. The writer finishes accepted work, flushes, then closes. Drop itself does no I/O. |
| Normal application exit | The existing blocking exit worker calls `update_peers::checkpoint_shutdown()`: disallow new registrations, close all writers, wait for completion. |
| Data or checkpoint I/O error | Stop the writer, attempt one final flush, report/log errors. Never publish a ledger unless the preceding data sync succeeded. |
| Completion | Require every block and the expected size, flush the last batch, read bytes, remove partial state, then let the unchanged upstream verifier authenticate the complete package before publication. Invalid signatures cannot leave a complete poisoned checkpoint. |
| Forced process exit, kill, OS crash | No flush guarantee. Resume may redownload the last uncommitted batch (up to the byte threshold, with timing dependent on I/O). It never infers completion from file length or unledgered bytes. |

The normal-exit call site is the blocking worker in `gui_terminal::defer_exit`.
Closing the updater UI already leaves its download running; this behavior is unchanged.
There is no separate updater pause UI. A crash after completion has retired the partial state,
but before the verified package reaches the cache, can require a full download, as in the
previous completion handoff; no unverified package is published.

## Verification and limitations (2026-11-01)

The task-scoped harness compiles the actual checkpoint source with a minimal surrounding
module. It passed 14 tests, with the manual benchmark ignored in the normal run.
Tests exercise failures before/after data write, data sync, ledger write/sync and replace;
an old ledger survives every interruption before replacement. They also cover truncated
and corrupt state, orphan temporary files, concurrent out-of-order writes, duplicate
blocks, explicit pause, cancellation, error cleanup, idle timer flush, and child-process
exit versus graceful shutdown.

The desktop test suite additionally contains signed HTTP range-resume and poisoned-ledger
tests in `checkpoint_download_tests.rs`, alongside existing multi-peer pipeline and
digest/signature tests. The real desktop target passed 66 updater tests, with 0 failures and 1 ignored manual
benchmark (`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test
codex_switch_lib_tests update_peers:: -- --test-threads=1`). This includes signed HTTP
resume, rejection of a self-consistent poisoned checkpoint, real multi-peer transfers,
slow/disconnected source recovery, range/protocol validation, and final verification.

The whole desktop crate also passed strict Clippy (test target, `-- -D warnings`)
and `cargo fmt -- --check`.

Only Windows/NTFS was exercised here. Unix directory-fsync behavior was reviewed in code
but macOS/Linux execution and physical power-loss tests were not available. Fault injection
proves ordering and conservative recovery; it does not certify drive firmware, write-cache
behavior on power loss, network filesystems, or hardware that ignores flushes.

## Storage microbenchmark

`checkpoint::tests::benchmark::checkpoint_storage_benchmark` reproduces the persistence
sequence at `04776426e` and compares it with the new Files implementation. Both process
64 MiB in identical 512 KiB in-memory blocks, including digest/JSON work and file creation.
Async dispatch, network transfer, final whole-package verification and cache publication
are excluded from both measurements. Four alternating before/after rounds use fresh
temporary directories, with no OS-cache eviction.

Environment: Windows, Rust 1.96.1, release optimization, fixed local F: NTFS volume.
The host reports ZHITAI TiPlus7100 and Samsung 990 PRO SSDs; the tool did not establish
which physical disk backs F:, so no specific disk model is attributed to the samples.
Other repair conversations were active; these are small local samples, not production
network throughput or a diagnosis of previously observed UI latency.

| Metric per 64 MiB | Before | Batched |
| --- | ---: | ---: |
| Data sync calls | 128 | 8 |
| Ledger sync calls | 128 | 8 |
| Ledger replacements | 128 | 8 |
| Measured local throughput range (MiB/s) | 83.13–84.20 | 521.89–612.97 |

Counts are instrumented calls, not an OS-wide trace. This demonstrates reduced durable
commit overhead for this storage workload; it does not establish a real-download speedup.
Raw release samples are in `update-checkpoint-benchmark.json`.

Reproduce against the actual desktop test target (after obtaining the shared verification slot):

```powershell
$env:CHECKPOINT_BENCH_DIR = 'F:/projects/codex-switch/.codex-tmp/task8'
cargo test --release --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests checkpoint_storage_benchmark -- --ignored --nocapture --test-threads=1
```

References: [Rust File synchronization](https://doc.rust-lang.org/std/fs/struct.File.html)
and [Microsoft MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw).