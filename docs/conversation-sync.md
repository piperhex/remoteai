# Codex GUI conversation synchronization

The conversation synchronization page accepts configured Codex Home folders from this PC and online PCs
on the signed-in account. Each source is identified by PC name and its path, joined with ` · `.
Built-in GUI homes and paths containing `dev.codex.switch` display `CodexGUI` in place of their path.
Their configured IDs and paths remain unchanged for synchronization.
The built-in GUI home is excluded only when it is also the destination.

Projectless conversations appear together in the expanded Recent group with their conversation titles.
Scratch directories exposed by older hosts are treated as projectless conversations rather than projects.
Project groups retain their paths and can be expanded separately. Folding a group preserves its selection.

Synchronization within the destination PC moves conversations after the destination commits successfully.
Synchronization between PCs copies conversations and retains every source file and database row.
Related conversations are included. Credentials, provider configuration and application settings are excluded.

The destination preview identifies duplicates, including related conversations. Users may skip them or explicitly
overwrite them. A changed destination invalidates that preview and requires a new confirmation. Overwritten
files, database state and index entries are backed up before replacement. A failed batch restores the destination
and any removed local source records; incomplete recovery retains the temporary backups and writes diagnostics.

The source snapshots conversations into a ZIP before transmission. Confirmation shows the original
conversation size and compressed size. Confirmed synchronizations enter the shared download queue and continue
after the dialog or conversation page closes. Progress counts bytes acknowledged by the destination; import
has a separate status. Completion means that SHA-256 verification and transactional import both succeeded.
The download record shows the import result rather than offering file-open or save actions for a temporary ZIP.
The UI displays the actual Relay/P2P path and measured speed for transfers between PCs.

## Resumption and cleanup

The source ZIP, destination ZIP prefix, import confirmation and import result have disk checkpoints.
The download record stores independent, random resume capabilities for both hosts. A new authenticated
remote session must present the matching capability before it can reuse a handle; a session disconnect
revokes its handles without deleting the resumable files. Source and destination runtimes must support
these capabilities before a managed synchronization can start.

On resume, the destination's acknowledged offset is authoritative, including when a write succeeded but
its response was lost. Size and SHA-256 must match the saved record. Destination changes still invalidate
the original overwrite confirmation. Import retries return the saved result rather than importing twice.

After import succeeds, both hosts automatically remove their temporary ZIPs, extracted files and
checkpoints. Interrupted cleanup stays recorded and is retried when the device directory refreshes.
Deleting an unfinished task also requests cleanup. Pauses and transfer failures preserve the checkpoints.
Abandoned checkpoints expire after seven days and are pruned when another synchronization is prepared.
Recovery files required by an incomplete transactional rollback remain protected.

## Transfer performance

The previous sender waited for a source read and destination write for every 12 KiB. This made throughput
depend on two request round trips per small chunk, even on a direct path. The new sender negotiates up to
256 KiB and prefetches at most four source ranges, while writing them in order. ZIP uses fast Deflate.
The bounded window also limits memory use and preserves a contiguous, resumable destination prefix.

P2P bypasses synchronization Relay pacing. Relay retains the authenticated server policy, whose default
is 200 KiB/s. The UI reports the actual path, so a Relay measurement must not be interpreted as P2P speed.

Run `node apps/desktop/scripts/benchmark-conversation-sync.mjs` to isolate request overhead with a fixed
synthetic latency. This is not a LAN or VM benchmark; actual throughput still depends on the selected
path, disk, compression ratio and host runtimes.

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
or move selection, pause/restart resumption, lost acknowledgements, successful-import cleanup and P2P bypass. Desktop and Web Playwright suites cover
source labels, duplication choices, live path/speed, dark mode and enlarged typography at narrow desktop widths.
