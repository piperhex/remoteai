# Chat maintenance scheduling

`internal/devices/chat_maintenance.go` owns one worker per responsibility. Every
worker calls its operation synchronously and owns a ticker, so missed ticks
coalesce into at most one pending run. There is no goroutine per tick or retry
queue. A gateway uses five workers, or six with bulk leases enabled.

| Worker | Interval | Ordering and storage limits |
| --- | --- | --- |
| Sessions and live traffic | 5 seconds | Prune expired sessions before publishing their in-memory byte counters; no database access. |
| Settlement and usage | 5 seconds | Attempt settlement (existing 10-second limit), then read/publish persisted usage (existing 30-second database limit). |
| Policy | 5 seconds | Existing refresh/broadcast contract; cancellable lock wait and bounded policy read. |
| Traffic persistence | 5 seconds | Cancellable serialization with other flush callers; transaction and gate wait share a 30-second limit. |
| Desktop ICE | Half the existing credential lifetime | Existing eligibility, signing and expiration rules. |
| Bulk reconciliation (optional) | 5 seconds | Existing 5-second limit; expiration still marks ambiguous leases without refunding them. |

## Accounting and shutdown

Live `relay-traffic` contains session byte counters; `relay-usage` contains the SQL
usage snapshot. SQL usage excludes open grants, and clients use that snapshot to
update quota status. The settlement attempt therefore stays ahead of usage
publication, including the existing publish-after-failure fallback. A slow
settlement can still delay **that quota snapshot**, but cannot delay live traffic,
policy, ICE, bulk reconciliation, or traffic persistence. It does not authorize
additional bytes or change budget lifetime, crash recovery or quota checks.

Shutdown cancels all workers before joining them. SQL/Redis operations receive
the cancellation context; policy refresh can also cancel while waiting for its
serialization lock. After workers have joined, final meter settlement and then
final traffic persistence retain their original order, so settlement completions
can precede the last statistics snapshot. Both use fresh bounded contexts.
Failed or cancelled statistics transactions retain pending
cumulative totals, including bytes recorded during the write, for an idempotent
retry.

## Local validation

Deterministic tests use `testing/synctest` and channel-controlled storage callbacks:

- A stalled task across 100 virtual ticks runs once while the independent task
  runs 100 times; releasing it does not replay the backlog.
- Cancellation reaches every worker before joining, including a policy refresh
  waiting behind a handshake. The test bubble also detects leaked workers.
- A blocked real meter flush allows repeated traffic and ICE frames, policy
  refresh, traffic persistence and bulk reconciliation. No usage frame precedes
  the settlement attempt; a transient failure recovers with exactly 30 bytes
  recorded after finalization.
- Cancelled statistics persistence retains concurrent bytes and retries without
  double counting. Each storage worker exits when its database call is cancelled.

The integration fixture uses disposable schemas on the existing loopback-only
PostgreSQL fixture (`127.0.0.1:15432`) and unique account keys in the local Redis
fixture (`127.0.0.1:16380`). It never loads deployment configuration.

```powershell
$env:CLIENT_READ_CACHE_TEST='1'
$env:ADMIN_GO_TRAFFIC_DB_TEST='1'
go -C apps/admin-go test ./internal/devices ./internal/chattraffic ./internal/content ./internal/readcache ./internal/server
go -C apps/admin-go test -race ./internal/devices ./internal/chattraffic ./internal/content ./internal/readcache ./internal/server
go -C apps/admin-go vet ./...
go -C apps/admin-go test ./internal/server -run TestKong
```

Race tests require a working C toolchain; Linux can use the same loopback fixtures.
These are local correctness/independence checks, not production latency measurements.
The protocol payloads and client code remain unchanged: desktop hosts receive
traffic/ICE, while desktop remote, web (both viewport modes) and native viewers
share the existing usage/policy handling. No UI appearance change is involved.
