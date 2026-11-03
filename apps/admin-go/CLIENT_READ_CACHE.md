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

`internal/readcache` combines concurrent misses within a process and returns a private decoded copy to
each caller. Generation-checked publication prevents a SQL read started before invalidation from
repopulating the cache afterward. Short lifetimes bound staleness if Redis invalidation fails.
Settings changed directly in SQL become visible after expiry; supported settings writers invalidate immediately.
Cancelled requests do not cancel other live callers sharing the same read.

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

With a C compiler available, also run `go test -race ./internal/readcache/... ./internal/identity
./internal/accounts ./internal/devices ./internal/content ./internal/chattraffic ./internal/lounge` on one line.
Quota and direct-message database regressions have their own opt-in flags documented alongside those tests.
