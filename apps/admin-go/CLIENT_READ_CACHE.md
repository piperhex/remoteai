# Client query optimization

These optimizations cover client HTTP requests and the device/chat WebSockets. They do not require a
database migration or change the public API. Redis failures fall back to PostgreSQL.

| Read | Cache lifetime | Freshness |
| --- | --- | --- |
| Chat/title/attachment policy | 5 seconds | Invalidate after settings commit, before policy broadcasts. |
| Download sharing policy | 5 seconds | Invalidate after settings commit. |
| Role permissions | 1 minute per role revision | Read user status, role assignment and PostgreSQL `xmin` live on every request. |
| Device directory | 30 seconds per owner | Invalidate registration, removal, active account/model changes and last-seen writes; compute online presence live. |
| Effective accounts | 1 minute per owner | Invalidate account, binding and system-account writes; share the read view across sync, summaries and details. |
| Port mapping configuration | 5 seconds per owner/device | GET uses no transaction or advisory lock. Invalidate successful CAS writes (including empty configurations), device removal and user deletion after commit. |

`internal/readcache` combines concurrent misses within a process and returns a private decoded copy to
each caller. Generation-checked publication prevents a SQL read started before invalidation from
repopulating the cache afterward. Short lifetimes bound staleness if Redis invalidation fails.
Settings changed directly in SQL become visible after expiry; supported settings writers invalidate immediately.
Cancelled requests do not cancel other live callers sharing the same read.

Port mapping ownership remains a live SQL check before either GET or PUT. Cold configuration GETs use
two SQL queries (ownership and configuration); warm GETs use one (ownership), plus the unchanged live
principal query in authentication. Neither read path begins a transaction. PUT still reads the current
revision under the per-owner/device advisory transaction lock and rejects stale snapshots, including
snapshots predating mapping deletion. Cache contents never supply the CAS revision for a write.

The shared client sync uses completion-based, single-flight polling: 30 seconds with enabled mappings,
60 seconds when idle, and 120 seconds in the background. HTTP failures back off from 5 seconds to 120
seconds. Browser offline signals suppress HTTP requests until recovery; native HTTP failures use the
same bounded retry because native has no reachability subscription. Returning to the foreground,
browser network recovery, tunnel reconnection and re-enabling a mapping request an immediate refresh.
Local edits also request immediate sync, and edits arriving during a request get one coalesced follow-up.
Pending edits/deletions remain durable across restarts. CAS conflicts retry after 5 seconds; capacity-only
overflow keeps the normal discovery cadence. Background timers may be suspended by the OS, in which case
foreground recovery refreshes immediately. No inactive client permanently stops discovering remote changes.

Desktop's local/remote component adapters and both native registry/fallback adapters share this engine.
The current Web desktop/mobile application does not expose port mappings (its discovery page filters the
entry); it has no separate polling implementation to update. The browser environment adapter is shared
and covered by the desktop Chromium fixture. This change adds no routes or UI/copy changes.

Authorization and write paths still read current user/account ownership, disabled state, revocable direct-message
permissions and spendable relay credit. Role and permission changes must remain in the same transaction
in `identity.saveRole`, including an update of the role row that advances its `xmin` revision.

The five-second usage push deduplicates owners and queries batches of 256: 1,000 owners require four SQL
queries instead of 1,000. Each push captures one month boundary; this is display data, not quota enforcement.
Relay allocation combines used and reserved credit in one query under the existing user lock, preserving grant
sizes, lifetimes and crash accounting. Established direct messages use a live generation check without
repeating the permission write transaction or pushing unchanged permissions; opening/reply/reset transitions
keep their transactional checks.

## Regression checks

`CLIENT_READ_CACHE_TEST=1` enables SQL-count, invalidation, owner-isolation, cancellation and concurrent-fill
tests. The fixture only connects to disposable local PostgreSQL at `127.0.0.1:15432` (database `admin_go`, user
`parity`, password `local-parity-only`) and Redis at `127.0.0.1:16380`, database 14. It creates and drops unique
PostgreSQL schemas and never reads deployment credentials. Start the local parity dependencies described in
[README.md](README.md), or use equivalent disposable containers with these ports and credentials.

From `apps/admin-go`, with those dependencies running:

```powershell
$env:CLIENT_READ_CACHE_TEST = '1'
go test ./...
go test ./internal/server -run TestKong
go vet ./...
```

`TestPortMappingsReadSQLBudgetAndNoTransactions` records 1,000 warm handler GETs as 1,000 live
ownership SELECTs and zero configuration queries, transactions or lock queries. It pins the fixture
entry lifetime only for that sample; a separate regression asserts the production five-second bound.
Other port mapping fixture tests cover live ownership denial, cache copying/owner/device isolation,
deletion invalidation, concurrent CAS, reads during a held writer lock and generation-fenced old reads.
`TestUserDeletionInvalidatesPortMappings` covers the user cascade, while the existing principal cache
tests verify live disable/role revocation. All SQL fixtures use unique disposable schemas.

With a C compiler available, also run `go test -race ./internal/readcache/... ./internal/identity
./internal/accounts ./internal/devices ./internal/content ./internal/chattraffic ./internal/lounge` on one line.
Quota and direct-message database regressions have their own opt-in flags documented alongside those tests.

## Account and Provider batch synchronization

Desktop uploads use the existing `PUT /sync/accounts` and `PUT /sync/providers` collections.
Each request contains at most 50 records, with an approximate 1 MiB body budget (an individual
oversized record travels alone and remains subject to the server's request limit).
Before each upload, the client reads the current collection and compares field versions at server millisecond precision, official
metadata and device active state. Tombstones are excluded. A denied read falls back to uploading
all local records, preserving write-only roles. Other read failures stop the attempt.

There is no persisted or process-local "uploaded" flag: first sync, changing server/user, a server
reset, and retry after a partially completed upload all use fresh remote state. A retry skips
already acknowledged versions and resends remaining records. Explicit single-record uploads,
deletes and restores retain their existing endpoints. Aggregate synchronization still runs after
Provider synchronization, including when no Provider upload is necessary.

The Go write path reads old rows, including tombstones, in owner-scoped groups of 256 within the
write transaction. Existing rows are locked during merging; duplicate IDs use the most recently
merged row. Official bindings and metadata permissions remain live checks. Account/Provider read
caches are invalidated only after an actual record write. Device active updates use a conditional
write and invalidate the device directory only if the stored active ID changes; device presence
and periodic last-seen updates remain owned by the device service.

Local regression evidence (not production latency measurements):

- 120 accounts or Providers: 1 snapshot GET plus 3 batch PUTs (50/50/20); unchanged repeat:
  1 GET and 0 PUTs. A full two-way sync also retains its initial download requests.
- A direct server batch of 120 new accounts uses 2 SELECTs plus 120 INSERTs; 120 new Providers
  use 1 SELECT plus 120 INSERTs. New records avoid an unsuccessful UPDATE before each INSERT.
- An unchanged direct server batch of 120 accounts: 2 SELECTs (bindings plus stored rows),
  0 writes. The equivalent Provider batch: 1 SELECT, 0 writes. Subsequent cached reads: 0 SQL.
- Covered cases include a failed second HTTP batch, retry against fresh server state, server reset,
  nullable fields, tombstones/restoration, official metadata permissions/private details, duplicate
  IDs, transaction rollback and device-only invalidation.

Run the HTTP/merge regressions with `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
--test codex_switch_lib_tests cloud:: -- --test-threads=1` (on one line). With the disposable fixture
above running, use `CLIENT_READ_CACHE_TEST=1` and `go test ./internal/accounts -run TestSyncBatch -v`.
The delayed-network test checks that the async runtime keeps progressing while the upload worker
is blocked; it does not measure native window frame latency.

The related single-account pull still downloads the collection. The existing details endpoint
omits the full authentication payload and cannot replace that download without an API change.
