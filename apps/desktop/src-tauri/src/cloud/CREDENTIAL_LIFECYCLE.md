# Cloud credential lifecycle

Cloud commands remain asynchronous Tauri commands with blocking work on workers.
The previous delay was serialization between cloud workers, not network work on
the Windows message thread.

## Ownership and lock boundaries

- `cloud_snapshot` reads settings and credentials together under
  `CLOUD_CREDENTIALS_LOCK`. Its in-memory snapshot binds a login epoch, server,
  owner and refresh version. The `cloud-auth.json` format stays compatible.
- Ordinary requests, response-body reads, local file collection and complete sync
  rounds do not hold the credential lock. Before sending, a request may adopt newer
  tokens only from its captured login. Its target must still match that login.
- Each login has its own `RefreshFlight`. Concurrent 401s and proactive renewals
  share one result, including transient failures. A later operation can retry a
  transient failure. Another login has an independent refresh coordinator.
- Refresh commits compare the login identity and token version. Rotated credentials
  are persisted before ancillary profile settings or the business retry. Business
  calls never save their old credential copies; they merge only a sync timestamp.
- `CloudResponse` validates the captured identity after JSON/text/streaming bodies
  finish. Local account, Provider, aggregate and usage-checkpoint writes additionally
  use `with_cloud_session`, which excludes identity changes during each local commit.
  The data guard never covers HTTP work. Lock order is data, credentials, lifecycle;
  refresh coordination never holds its internal mutex while invoking cloud work.

## Authentication transitions

Login attempts have a separate version. A newer attempt prevents a late older
attempt from installing its tokens, while a failed attempt leaves the active
session and its in-flight refresh intact. Once authentication succeeds, credentials
are installed before the initial download/merge/upload sequence so that other
workers and 401 retries use one consistent session. A later sync error cannot lose
the authenticated or rotated tokens. Remote data is still merged before upload.

Logout, server changes and refresh rejection invalidate the login epoch under the
short local commit boundary. Logout clears local state before best-effort remote
revocation. A late successful refresh from an invalidated epoch is discarded and
its replacement token is revoked against the original server. Old refresh
rejections cannot sign out a new account. Refresh 401/403 still expire the current
session; other refresh failures retain it. Each business request still retries at
most once after 401.

Requests already dispatched may finish at their original server. This mechanism
does not undo remote side effects; it prevents responses, retries and local writes
from crossing into another login. Server authorization, ownership and quota checks
remain on every request.

## Regression evidence

`credential_tests` and `official_usage/credential_tests.rs` use unique MockRuntime
application directories and loopback HTTP only. The complete sync probe runs in a
child with a temporary `CODEX_HOME`; it never reads real account files. Tests gate
HTTP responses explicitly rather than relying on short production timeouts.

Coverage includes slow sync and usage upload versus device reads, real async sync
versus auth polling and port mappings, eight concurrent 401s sharing one refresh,
shared transient failures, late success after rotation, slow response bodies,
logout, account/server changes, same-account relogin, overlapping login attempts,
failed login during renewal, new-login renewal while the old refresh is stalled,
and revocation of discarded rotated tokens.

Run from the repository root (set the normal Windows check profile debug levels
to zero, as in `scripts/check-desktop-rust.mjs`):

```text
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests cloud:: -- --test-threads=1
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --tests
npm run build -w @codex-switch/desktop
```

`apps/desktop/e2e/cloud-concurrency.pw.ts` exercises real UI components with gated
transport fixtures in bundled Chromium, through both the native invoke adapter and
the hosted HTTP adapter. Input, clicks, auth reads and three session polls must
complete before sync is released. This browser harness complements the real Rust
HTTP fixtures; it is not an installed WebView or physical-device test.

Desktop local and remote pages use these same Rust cloud commands; hosted desktop
dispatch continues to await them on its request workers. Standalone web/mobile web
and native use separate asynchronous fetch-based clients, not this Rust mutex.
Existing `useGuiComputers`, `webSessionRefresh` and native `sessionRefresh` tests
cover selection, polling, identity changes and refresh sharing at those boundaries.
