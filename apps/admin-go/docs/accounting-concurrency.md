# Relay accounting concurrency verification — 2026-11-03

Ordinary `Meter.Transmit` now spends an immutable current grant concurrently through
the existing atomic Redis ticket script. Only retiring/replacing a grant is serialized
per account, with a context-aware gate and a recheck after acquiring it. Redis sealing
orders racing predebits: they either become pending before sealing or are rejected.
No accounting gate is held while invoking the transport write callback.

The SQL grant remains 256 KiB / five seconds. SQL row locking, outstanding-credit
calculation, quota epochs, Redis process identity checks, and idempotent settlement
remain the authority. There are no database migrations or production flag changes.
The separate, default-off bulk lease path is not enabled by this change.

The installed go-redis client can continue socket I/O after its caller is cancelled.
The meter therefore bounds active plus abandoned reservations to 64 workers and
completion workers to another 64. Waiting for either capacity or a budget renewal
honors context cancellation. A cancelled caller returns without waiting for storage;
the bounded worker owns the remaining receipt/refund work. There is no detached
unbounded queue. Grant churn is limited to three reservation attempts per call, after
which the caller receives the existing retryable accounting-unavailable error.

Before invoking the writer, the meter checks both context cancellation and grant
expiry. Confirmed tickets with no attempted write can be refunded. Unknown predebit
outcomes and failed write callbacks retain credit: an error-only writer cannot prove
that zero bytes were sent. Recovery conservatively charges those pending bytes after
the existing grace period. This strengthens the old behavior, which refunded any
write error. A successful write still records its ticket even if cancellation occurs
during completion. If completion is unavailable or saturated, the durable pending
ticket remains available to conservative recovery.

## Measurements

[Machine-readable evidence](accounting-concurrency-evidence.json) preserves all three
samples, test names, skipped cases, and race results. The baseline is revision
`67cb2c9d2c30067641ede6417cec7e1830419699`, tested in a separate local copy. Its fixture
ports were adjusted to the isolated stores; production code was unchanged.

Windows amd64, Go 1.26.8, Docker Desktop, local Redis 7.4.7 and PostgreSQL 16.11;
synthetic users only. Every stream sends 16 frames. The write callback completes
immediately. Timing includes reservation and completion, but excludes setup and final
recovery/assertions. Added delay is applied before each Redis command and SQL statement,
while real Lua scripts and SQL transactions still execute. These are short controlled
experiments, not production capacity estimates. Other development work shared the host.

Medians across three runs (p95 is the median of each run's measured frame-latency p95):

| Scenario | Added delay | Frames/s before → after | Frame p95 before → after |
| --- | --- | --- | --- |
| 1 stream, 1200 bytes | 2 ms | 177.5 → 185.2 | 6.32 → 6.23 ms |
| 8 streams, same account, 1200 bytes | 2 ms | 352.0 → 1257.8 | 25.50 → 6.79 ms |
| 8 streams, separate accounts, 1200 bytes | 2 ms | 1206.5 → 1362.8 | 6.99 → 6.38 ms |
| 8 streams, same account, 16 KiB / renewal | 2 ms | 154.5 → 249.4 | 82.47 → 66.89 ms |
| 8 streams, same account, 1200 bytes | none | 2416.6 → 5956.6 | 5.73 → 1.69 ms |

The same-account small-frame case improved approximately 3.57 times with injected
delay. Single-stream throughput still pays synchronous predebit/completion round trips.
Budget renewal still performs the necessary serialized SQL transactions.

## Verification

- Accounting: 35 top-level tests / 47 tests including subtests passed, zero skipped.
  This includes all 17 original opt-in storage integration tests and the throughput test.
- Combined accounting/devices/mediarelay/server run: 245 tests including subtests passed;
  five external-condition tests in devices/mediarelay were skipped and are recorded
  explicitly in the evidence. `TestKong` and `go vet` passed separately.
- Linux `go test -race` passed for all four packages, with real storage integration
  enabled. The optional throughput test was not enabled in the race run.
- Actual Redis `CLIENT PAUSE 350 ALL`: a 30 ms relay deadline returned at approximately
  30 ms without invoking the writer. The confirmed late ticket was refunded.
- A held PostgreSQL account row lock did not block a second account; the blocked
  request observed its deadline and did not leak an allocation.
- Tests cover cancellation before/while queued, after budget initialization, after
  confirmed predebit, during completion, and after writing; bounded abandoned work;
  overlapping same-account predebits; multiple meters competing for one quota;
  ambiguous predebit and completion outcomes; failed writes; idempotent recovery;
  Redis loss and stale process identity; quota fencing; expired grants and month/hour
  attribution. The existing slow-socket test still passes.

An initial combined race run caught a compile error in a concurrently edited HTTP
download test outside this task. That file was left to its owning conversation; after
its update, the combined run above passed. No devices, server, bulk lease, or frozen
NestJS implementation files were changed by this task.

## Reproduce locally

Use disposable Redis/PostgreSQL instances, with the existing fixture credentials
(`parity` / `local-parity-only`, database `admin_go`). The fixture always uses loopback;
only its ports may be overridden. It creates the accounting tables from migrations
004, 005, and 009. On an otherwise empty fixture database, first create the minimal
synthetic user table:

```sql
CREATE TABLE users (
    id uuid PRIMARY KEY,
    email text NOT NULL,
    "passwordHash" text NOT NULL,
    role text NOT NULL
);
```

From the repository root in PowerShell:

```powershell
$env:ADMIN_GO_TRAFFIC_DB_TEST = '1'
$env:ADMIN_GO_TRAFFIC_POSTGRES_PORT = '15439'
$env:ADMIN_GO_TRAFFIC_REDIS_PORT = '16389'
$env:ADMIN_GO_TRAFFIC_LOAD_TEST = '1'
go -C apps/admin-go test ./internal/chattraffic -count=3 -v -timeout 2m
go -C apps/admin-go test ./internal/chattraffic ./internal/devices ./internal/mediarelay ./internal/server
go -C apps/admin-go test ./internal/server -run TestKong -count=1
```

On a host with a C compiler, repeat the package tests using `-race`. This verification
used a disposable Go 1.26.8 Alpine container with GCC and musl-dev for that step.

## Limits

No production data, deployment, production switch, real TURN client/load generator,
cross-host network, prolonged load, or Redis process failover was exercised. Process
identity rollback is simulated in the existing real-Redis test. The storage tests do
not establish end-to-end desktop media throughput. Once the transport callback has
started, its own socket deadlines govern cancellation; the meter's error-only callback
API cannot interrupt an arbitrary running write. Ambiguous outcomes may conservatively
charge bytes not actually delivered; they must never release credit that could have
been delivered. Existing grace-period recovery and bounded SQL budgets remain in use.
