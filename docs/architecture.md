# Architecture and Data Flow

This document describes the responsibility boundaries, key data flows, persistence, and security constraints of Remote AI.

## Overview

```mermaid
flowchart LR
    DesktopUI["Desktop React dashboard, bubble, and Token Usage window"] --> Hooks["Business hooks"]
    Hooks --> Adapter["Frontend API adapter"]
    Adapter -->|"Tauri invoke / events"| Rust["Rust backend"]
    Tray["System tray"] --> Rust
    Rust --> LocalStore["Accounts, Providers, settings, and history"]
    Rust --> CodexFiles["$CODEX_HOME/auth.json and config.toml"]
    Rust --> OfficialAPI["Official Codex APIs"]
    Codex["Local Codex client"] --> Loopback["127.0.0.1:15722 local proxy"]
    Loopback --> OfficialAPI
    Loopback --> ProviderAPI["Third-party Provider APIs"]
    Rust -->|"Optional credential sync"| Cloud["Self-hosted Go backend"]
    AdminUI["Admin console"] --> Cloud
    Mobile["Expo mobile companion"] -->|"Account summaries"| Cloud
    Cloud -->|"Short-lived Codex access token"| Mobile
    Mobile -->|"Live usage and reset-card requests"| OfficialAPI
    Cloud --> Postgres["PostgreSQL"]
    Cloud --> Redis["Redis cache"]
```

The desktop React frontend receives redacted models such as `AccountSummary`, `ProviderSummary`, `UsageSummary`, `ResetCreditsSummary`, `CloudAuthState`, and `TokenUsageEntry`. Complete account credentials and Provider API keys remain in Rust. They leave the device only when the user exports a `.cs` backup or enables synchronization with a configured backend.

## Desktop Frontend Responsibilities

- `apps/desktop/src/api/backend.ts` is the only entry point for Tauri IPC and file selection. It also provides browser-preview behavior.
- `apps/desktop/src/hooks/useAccountManager.ts` orchestrates loading, login, compatible JSON and `.cs` import/export, switching, deletion, and usage refreshes.
- `apps/desktop/src/hooks/useProviderManager.ts` owns Provider profiles, model selection, local-proxy state, and quota-failover settings.
- `apps/desktop/src/hooks/useCloudAuth.ts` owns optional backend configuration, login, logout, and synchronization.
- `apps/desktop/src/hooks/useResetCredits.ts` owns reset-credit counts and consumption. `useAutoRefresh.ts` owns both refresh timers.
- `useFloatingBubble.ts`, `useThemeColor.ts`, `usePrivacyMode.ts`, `useBubbleResetDisplay.ts`, and `useLanguage.ts` manage UI and window preferences.
- `apps/desktop/src/pages/` composes page layouts and does not call Tauri directly.
- `apps/desktop/src/components/` contains presentation and local interactions. `FloatingUsageBubble.tsx` and `TokenUsageWindow.tsx` render standalone Tauri windows.
- `apps/desktop/src/utils/` contains pure formatting and theme helpers.

## Rust Backend Responsibilities

- `models.rs` defines redacted IPC responses, local state, and cloud synchronization payloads.
- `auth.rs` decodes JWT payloads, validates credentials, and generates stable account IDs.
- `storage.rs` resolves data directories and handles JSON reads, atomic replacement, metadata, and account-store synchronization.
- `codex_api.rs` refreshes tokens, sends authorized requests, and parses usage and reset-credit responses.
- `oauth.rs` owns PKCE parameters, the local callback server, the embedded login window, and credential exchange.
- `commands.rs` exposes account, compatible-import, usage, reset-credit, update, folder, and process-restart commands.
- `account_archive.rs` packages and restores account credentials, metadata, usage, Provider profiles, and active identifiers in `.cs` archives.
- `providers.rs` validates Provider profiles, stores API keys, backs up the original Codex config, and writes managed `config.toml` sections and model catalogs.
- `local_proxy.rs` owns the loopback server, official/Provider routing, Chat Completions-to-Responses bridging, diagnostics, token history, and official-account quota failover.
- `cloud.rs` owns optional backend authentication and last-modified-wins synchronization for complete account and Provider payloads.
- `floating_bubble.rs` owns the floating window, persisted app settings, cross-window events, context-menu positioning, and bubble-position persistence.
- `system_tray.rs` owns tray menus, dashboard reveal behavior, account quick switching, and the restart action.
- `lib.rs` registers plugins, windows, tray setup, event handlers, and commands and restores the local proxy when it was enabled at shutdown.

## Cloud Backend and Mobile Responsibilities

- `apps/admin-go` is the production backend and exposes registration/login, refresh-token, account sync, Provider sync, mobile-summary, and admin-management routes.
- PostgreSQL stores users, dynamic RBAC roles, built-in and custom permission definitions, role-permission assignments, refresh tokens, synchronized account credentials, Provider API keys, admin audit data, customizable email templates, encrypted custom SMTP services, announcement link-click details, feedback with image attachments, and the optional official-account pool. Redis caches account and Provider lists.
- The admin console at `/admin` manages roles and permissions (including custom permission definitions for external systems), users, their synchronized accounts and Providers, invitations, approval requests, notification email templates and sending services, feedback and replies, audit logs, and official-account assignments. The SMTP service from environment variables remains the read-only default; templates and manual feedback replies can select an enabled custom service.
- An official account assigned to a user is merged into that user's effective sync list. The assigned system copy wins when its stable account ID collides with a personal copy, and it must be edited or removed from the official pool.
- `apps/native` stores only its cloud login session in the platform secure store and reads `/sync/accounts/summary`. The response excludes each complete `auth` payload but includes the short-lived Codex access token. The mobile app keeps that token in runtime memory and uses it to query official usage and reset-card endpoints directly.

## Key Data Flows

### Login and Import

1. For OAuth login, Rust creates a PKCE verifier, challenge, and random state, starts a local callback listener, exchanges the returned code, and validates the state.
2. A normal `auth.json` import validates the selected file directly. Compatible import accepts a JSON object, an array, an `{ "accounts": [...] }` wrapper, or newline-delimited objects and extracts common token, credential, auth, or session fields.
3. If compatible input contains only a refresh token, Rust attempts an official token refresh before validation.
4. Rust derives the stable account ID, writes a canonical `auth.json` to the managed store, emits `accounts-changed`, and optionally pushes the account when cloud sync is authenticated.

### Backup Import and Export

1. Export synchronizes the active `auth.json` into the managed store and collects account credentials, notes, expiry metadata, usage, Provider profiles, and active IDs.
2. The payload is compressed and placed in a `.cs` container. The format keeps secrets out of casual plaintext inspection but does not use a user-supplied or device-specific key, so the file must still be handled as a credential backup.
3. Import validates every account and Provider before merging them by stable identifier and restoring active state where possible.

### Account Switching and Usage

1. Before a switch, the backend makes a best-effort copy of the current `$CODEX_HOME/auth.json` to preserve tokens Codex may have refreshed.
2. It revalidates the selected managed account and atomically replaces `$CODEX_HOME/auth.json`.
3. It updates `state.json`; if the local proxy is running, it reapplies the proxy config so the new official credential is used without changing Codex's endpoint.
4. Usage refresh treats the active `$CODEX_HOME/auth.json` as authoritative, refreshes tokens before expiry or after a `401`, and saves only the parsed windows to `usage.json`.

### Provider Switching and Local Proxy

1. A Provider profile contains a name, upstream Base URL, API key, active model, model list, API format, and model-selection owner. IPC returns only `hasApiKey`, never the key.
2. Third-party Providers can be activated only while the local proxy is running. The original Codex config is backed up before the proxy writes its managed root/provider sections.
3. Starting the proxy binds `127.0.0.1:15722`, writes a local Provider entry to `config.toml`, and persists the enabled state. Subsequent official-account, Provider, and model switches update the proxy target without requiring a Codex restart.
4. The proxy records redacted diagnostics and extracts token counts from completed Responses streams into SQLite and JSONL history. The Token Usage window displays the newest 500 rows; the database retains up to 10,000.
5. Upstream `429` responses stay inside the proxy while it retries after progressively longer 1, 3, and 5
   second waits. The default five-minute time budget is configurable. When official-account quota failover is
   enabled, eligible quota responses can also switch to the account with the lowest primary-window used
   percentage before the next attempt. Only the final response reaches the client.

### Cloud Synchronization

1. Cloud login is disabled until a backend Base URL is saved in Settings. Desktop access and refresh tokens are stored locally in `cloud-auth.json`.
2. After authentication, account and Provider changes push complete payloads to the configured server. Manual sync downloads remote changes and then uploads local entries; `lastModifiedAt` resolves competing edits.
3. Full `/sync/accounts` responses are for desktop synchronization. `/sync/accounts/summary` removes `auth`, refresh tokens, and ID tokens, then adds only the short-lived Codex access token needed by the mobile app.
4. Cloud logout removes the local cloud session but does not delete synchronized server data or local account data.

### Issue Feedback

1. The Help dialog opens a feedback form that includes the app version and platform user agent. Signed-in submissions use the existing cloud JWT so the backend binds the verified account email; anonymous submissions contain no contact email.
2. A submission accepts up to four JPEG, PNG, or WebP images. The desktop UI compresses any image larger than 5 MB before IPC, and both Rust and admin-go enforce the 5 MB per-image limit again.
3. Feedback image bytes remain in PostgreSQL and are only returned through permission-guarded admin endpoints. The admin console can preview attachments and send a plain-text SMTP reply when a verified email is available.

### Announcement Link Analytics

1. The desktop client reports every configured announcement-link click with its stable installation ID, operating-system platform, and announcement update timestamp before opening the URL.
2. Signed-in reports reuse the cloud JWT so the backend records the verified account email; signed-out clicks remain countable with a null email.
3. The announcement management page shows total and recent click counts, platform distribution, and searchable click details. Click reporting failures never block the user from opening the link.

### Settings, Tray, and Auxiliary Windows

1. App settings such as the floating bubble, theme, privacy mode, reset-time display, bubble position, and cloud profile are stored in `settings.json`.
2. Language and the two auto-refresh timers are UI-only WebView preferences. Cross-window events keep language, theme, and bubble display synchronized.
3. The tray and floating-bubble context menus are rebuilt after account, usage, or Provider changes.
4. Auxiliary Tauri windows use dedicated labels (`usage-bubble`, `token-usage`, and `login`) and must be listed in the default capability file.

### Token Usage Analytics

1. The summary includes daily stacked token charts for short/long context and standard/fast mode. These charts scan all requests in the selected range, independently of the recent-request ranking limit. Long context means input tokens exceed the configured long-context threshold, including cached input. Each request contributes its raw total once per chart; cached input and reasoning output are not added again.
2. Missing input or service-mode metadata stays in an unknown category. `priority`/`fast` identify fast mode and `default`/`standard` identify standard mode. Billing multipliers do not change these token totals.
3. Successful official-account quota refreshes append remaining primary/secondary percentages and reset times to `account-quota-history.sqlite3`. The chart starts accumulating history after this feature is installed; it cannot reconstruct earlier quota levels. Failed refreshes never create observations.
4. Quota queries return the latest observation before the selected range as a baseline. Hourly, six-hour, and daily decreases are assigned to observation times. Resets, increases, missing values, and observation gaps longer than the selected interval are not inferred as usage. The remaining-quota view breaks the curve at those boundaries.
5. Both analytics commands perform their complete filesystem/database work on blocking workers. Dashboard polling is single-flight, and range changes queue the latest selection while discarding obsolete results.

### Restart ChatGPT

1. The dashboard, tray, or bubble calls `restart_chatgpt` when a config or credential switch is not picked up by a running session.
2. Windows process control verifies the desktop installation layout and executable paths. It stops only the initially observed desktop shell and bundled helper instances, using a checked process handle; standalone CLI processes and newly spawned instances are excluded. Store launches require a current, healthy package identity, and packages undergoing deployment or servicing are skipped.
3. macOS and Linux use the available platform process and launch strategy. Restart is best effort and does not read or log credentials.
4. Renderer recovery requires a continuous 30-second CDP outage, an active skin or running proxy, and a confirmed running desktop installation matching the executable saved in that session. A replacement installed by an updater never becomes eligible through the old session, even after the grace period. Each explicit managed launch permits at most one automatic recovery, persisted before any process is stopped. Reconnecting or restarting Remote AI does not reset that allowance. The monitor skips busy operations and rechecks the launch identity, current CDP availability, feature state, and installation before recovery. See [Windows update compatibility](chatgpt-update-compatibility.md) for the investigation and diagnostic steps.
5. An interrupted or failed renderer launch clears the saved port while retaining the executable. Skin verification errors preserve an already working renderer channel. A startup timeout never triggers a second launch into a different installation. Pausing a skin disables recovery for that skin; a running proxy can still require the channel.
6. The resource updater removes abandoned theme archives and staging directories before downloading, while holding its single-flight guard. Cleanup accepts only managed UUID names inside the resource cache and preserves unknown entries, the current pack, and trees containing links or Windows reparse points. This cleanup does not touch ChatGPT's own runtime directories.
7. The connection indicator before the proxy controls checks the live Codex main renderer on a single-flight timer. Clicking a disconnected indicator first attempts a non-destructive reconnect; a separate confirmation is required before its restart action. Status reads and reconnects do not reset the recovery allowance. LAN views can read the state but cannot reconnect or restart the host application.

## Persisted Data Layout

```text
OS application data/
  state.json
  settings.json
  cloud-auth.json
  config-before-provider.toml
  token-usage.sqlite3
  account-quota-history.sqlite3
  accounts/
    <stable account ID>/
      auth.json
      usage.json
      note.txt
      expires-at.txt
      last-modified-at.txt
  providers/
    <provider ID>.json
  logs/
    local-proxy-diagnostics.jsonl
    token-usage.jsonl

$CODEX_HOME/
  auth.json
  config.toml
  codex-switch-model-catalog.json
```

Some files are created only after the corresponding feature is used. The stable account ID is a truncated hash of the user identity and ChatGPT account ID and does not contain token data.

The WebView `localStorage` contains UI-only preferences such as language, last all-account refresh time, and global/current-account auto-refresh state.

## Security Boundary

- The desktop React UI never receives complete account credentials or Provider API keys. Provider summaries expose only whether a key exists.
- Local account, Provider, desktop cloud-session, and diagnostic files are not protected by an additional application-level at-rest encryption layer. Operating-system account and file permissions remain part of the trust boundary.
- `.cs` archives contain restorable secrets. Their built-in container protection is not a substitute for access control or a user-held encryption key.
- Enabling cloud sync deliberately sends complete account credentials and Provider API keys to the configured backend. Use HTTPS and a server whose operators and storage you trust.
- The admin official-account workflow accepts and stores complete `auth.json` objects. Admin access, PostgreSQL backups, logs, and operational tooling must be treated as credential-bearing systems.
- Mobile receives a short-lived Codex access token for every supported account. These tokens are kept in runtime memory rather than Expo SecureStore, but they still grant upstream account access while valid; mobile devices and backend responses are part of the credential trust boundary.
- Mobile cloud access and refresh tokens are also sensitive and are stored through Expo SecureStore.
- Proxy diagnostics summarize request shapes and selected response details; authorization headers, prompt text, and full successful response bodies must not be logged.
- `auth.json`, `.cs` backups, exported diagnostics, and production database dumps must never be committed. Diagnostics can contain upstream error details even though request content and credential headers are summarized or omitted. Test fixtures must use unusable fake values.
- Atomic writes reduce corruption risk but do not provide confidentiality. OAuth state and PKCE reduce forged-callback and intercepted-code risk.
