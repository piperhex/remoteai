# Contact presence reverse index verification

Measured on 2026-11-01 using Go 1.26.8, Windows/amd64, Intel Core Ultra 9 285K.
The baseline is the actual production implementation at `04776426e`, not the older review baseline.
No branch was reset: the baseline module was exported with `git archive` into an isolated temporary directory.

## Behavior and ownership

- `hub.mu` owns the user-to-connection index, reverse subscriptions, presence snapshots, and expiry timers.
- Watch replacement affects only that connection; identical replacements still send a fresh snapshot.
  Duplicate and self IDs are filtered, invalid replacements are atomic, and empty replacements unsubscribe.
- An account is online if any authenticated, unexpired, non-closing connection is active.
  An expiry callback updates that user's subscribers without scanning unrelated connections.
  Renewal cancels the timer and rejects already-running callbacks for an older expiry.
- Privacy changes update the actor's and target's connections. Blockers remain hidden from blocked viewers;
  the reverse direction remains visible. Unauthorized/expired viewers receive no contact updates.
- Disconnect removes both index directions and cached subscription state. Reconnecting creates a new subscription.
- Contact frames enter the existing bounded FIFO under the hub lock, preserving transition order and deduplication.
  Socket writes run in the writer; overflow marks the connection closed and interrupts the socket asynchronously.
  Hub shutdown first marks all peers stopped, then closes sockets after releasing the hub lock.
- No routes, public frame schemas, client UI, translations, NestJS code, or production deployment changed.

## Method

Each connection has 16 stable subscriptions, initially to offline contacts. Setup is excluded from timing.
`SparseWatch` repeatedly replaces one connection's subscription and drains its in-memory queue.
`SparseStatus` uses two workers contending on the actual hub mutex, toggling one account's authenticated flag
and publishing to four subscribers. This isolates contact propagation from the rest of connection setup/teardown.
It includes serialization, enqueueing and draining those four queues; it performs no socket or database I/O.
`locked-ns/op` measures from successful lock acquisition until immediately before unlock.
`wait-ns/op` measures elapsed time around mutex acquisition, including scheduler delay.

Run each size three times, with `-cpu=2 -benchtime=500ms -benchmem`. Values below are medians of three runs.
The final timing harness ends the critical-section timer before unlocking; earlier exploratory runs that included
post-unlock scheduling are excluded. Both baseline and new implementation were rerun with the final harness.
Raw results: [baseline](before-final.txt), [indexed](after-final.txt).

| Connections | Watch before / after (us/op) | Status before / after (us/op) | Lock held before / after (us/op) | Lock wait before / after (us/op) |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 92.833 / 5.980 | 82.533 / 2.102 | 80.568 / 1.806 | 82.461 / 2.121 |
| 1,000 | 866.766 / 5.726 | 785.739 / 2.041 | 778.990 / 1.785 | 780.255 / 1.990 |
| 10,000 | 16,561.900 / 5.931 | 15,878.367 / 2.015 | 15,882.092 / 1.698 | 15,530.914 / 1.902 |

At 10,000 connections, watch allocations decrease from 160,097 to 34 per operation, and bytes from
1,037,720 to 4,456. Status propagation decreases from 160,087 to 16 allocations and 1,033,955 to 676 bytes.

Keeping 10,000 connections fixed and increasing affected subscribers shows work following the affected set:

| Affected subscribers | Indexed status (us/op) | Lock held (us/op) | Allocations/op |
| ---: | ---: | ---: | ---: |
| 4 | 1.954 | 1.691 | 16 |
| 64 | 26.207 | 23.870 | 256 |
| 512 | 217.809 | 214.310 | 2,048 |

These are synthetic in-memory measurements on a shared development host, not production latency or a measured
user-visible stall. They exclude network latency, permission database queries, and global moderator online-count
publication, which still scans connections on join/leave. Reverse indexes add O(connections + subscriptions)
storage and one expiry timer per authenticated connection; this benchmark does not measure retained heap usage.
There is no inference here about runtime leaks, Mermaid, or earlier build OOMs.

## Reproduction

From the repository root, run the current implementation:

```powershell
go -C apps/admin-go test -p 2 ./internal/lounge -run '^$' -bench BenchmarkContactPresence -benchmem -benchtime=500ms -count=3 -cpu=2
```

To reproduce the baseline, export `apps/admin-go` from `04776426e` to a separate directory with `git archive`,
copy [baseline_bench_test.go](baseline_bench_test.go) into its `internal/lounge` directory, then run the same
command against that directory with `-bench BenchmarkContactPresenceSparse`. The stored baseline harness differs
only in fixture/index initialization and invoking the original no-argument global publisher.

## Correctness checks

Executed against the final Go source:

```powershell
go -C apps/admin-go test -p 2 ./internal/lounge -count=3 -json
go -C apps/admin-go test -p 2 ./internal/server -run TestKong -count=1 -json
go -C apps/admin-go vet -p 2 ./internal/lounge
```

Lounge: 52 top-level tests x 3 runs = 156 passed, zero failed. Kong: 2 passed, zero failed.
`gofmt -l` for all changed Go files and `git diff --check` produced no findings.
The new tests cover replacement/cancel/validation, self and duplicate IDs, first/last device, expiry, stale expiry
callbacks, renewal ordering, privacy, inactive users, reconnect, two queue overflow limits, and hub shutdown with
a deliberately blocked network Close. Eight concurrent workers perform 400 connection lifecycles while another worker toggles
presence 400 times; assertions check both index directions and stale entries.

Windows `go test -race` could not run because CGO is disabled and no C compiler is installed. Race validation
instead ran locally in an isolated `golang:1.26.8-alpine` Docker container (Linux/amd64), with `gcc musl-dev`,
`CGO_ENABLED=1`, `GOMAXPROCS=2`, `--cpus 2`, `--memory 4g`, and the source mounted read-only:

```sh
go test -race -p 2 ./internal/lounge -count=3 -json
```

All 52 top-level tests x 3 runs passed, zero failures or race reports. JSON logs are retained locally in
`.codex-tmp/contact-presence-results/{lounge-final,kong-final,race-linux-final}.json` at the repository root.
This is backend-only verification; no UI screenshots or physical-device tests apply.
