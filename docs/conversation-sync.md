# Codex GUI conversation synchronization

The conversation synchronization page accepts configured Codex Home folders from this PC and online PCs
on the signed-in account. Each source is identified by PC name and its unchanged path, joined with ` · `.
The built-in GUI home is excluded only when it is also the destination.

Synchronization within the destination PC moves conversations after the destination commits successfully.
Synchronization between PCs copies conversations and retains every source file and database row.
Related conversations are included. Credentials, provider configuration and application settings are excluded.

The destination preview identifies duplicates, including related conversations. Users may skip them or explicitly
overwrite them. A changed destination invalidates that preview and requires a new confirmation. Overwritten
files, database state and index entries are backed up before replacement. A failed batch restores the destination
and any removed local source records; incomplete recovery retains the temporary backups and writes diagnostics.

Remote packages use authenticated, encrypted chat connections with bounded, retry-safe 12 KiB chunks and
SHA-256 package verification. Transfer identifiers are bound to the remote session. Connections and temporary
packages are released when the panel or session closes. Interrupted requests never authorize source deletion.
The UI displays the active Relay/P2P path and measured package transfer speed only for transfers between PCs.

## Server configuration

`conversationSyncRelayKbps` is an optional positive integer in the existing authenticated chat settings policy.
Its default is `200`, measured in KiB/s (200 × 1024 bytes/s). Older saved policies and servers retain this default.
Administrators can read `GET /admin/api/chat-settings`, update this property in the complete returned policy,
and submit it to `PATCH /admin/api/chat-settings` with the existing `admin.chat-settings.manage` permission.
The coordinator broadcasts policy changes to connected hosts; no desktop configuration or restart is required.

Only conversation synchronization chunks are paced by this setting. The current transport mode determines
whether pacing applies: Relay uses the configured budget, P2P bypasses it. The normal chat, file download,
and remote desktop budgets keep their existing behavior. Remote synchronization does not display the policy
value or transport implementation details in its instructions.

## Verification

Rust synchronization tests cover local moves, remote copies, overwrites, rollback, archive integrity and
idempotent chunk retries. Desktop transport tests cover policy compatibility, remote session ownership, copy
or move selection, interrupted transfer cleanup and P2P bypass. Desktop and Web Playwright suites cover
source labels, duplication choices, live path/speed, dark mode and enlarged typography at narrow desktop widths.
