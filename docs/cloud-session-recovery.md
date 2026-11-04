# Cloud session refresh recovery

The backend rotates refresh tokens every time `/auth/refresh` succeeds. Previously, losing the
successful response left the desktop with a revoked token; its next retry received HTTP 401 and
cleared the cloud login. A regression test reproduces this on the previous implementation.
This establishes a reproducible failure path, not attribution to a particular user's report.

For 120 seconds after rotation, retries with the original token can recover the same replacement.
Recovery does not rotate again or extend this window. PostgreSQL still validates the original
token hash and expiry, the current user, and the replacement's live status under row locks.
Logout with either token and password reset prevent recovery. Already rotated replacements
cannot be used to walk a chain of old sessions.

Redis holds the encrypted replacement for this bounded window. Its cache key is a hash; decryption
requires the original high-entropy refresh token, which is not stored in Redis. A failed cache
write rolls back the database rotation. A database rollback cannot expose an uncommitted token
through recovery. No schema migration or desktop update is required.

This does not recover retries made after the window, expired sessions, or credentials revoked
before the fix was deployed. Users whose credentials have already been cleared must sign in again.

## Verification

Run `npm run check:backend` for the maintained Go implementation. The isolated identity parity
suite in [admin-go](../apps/admin/README.md#本地-docker-对照测试) verifies rotation, concurrent
retries, logout, and encrypted recovery against real disposable PostgreSQL and Redis instances.
The frozen NestJS tests remain historical regression evidence; they are not a deployment entrypoint.
