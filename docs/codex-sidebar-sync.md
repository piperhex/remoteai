# Local Codex sidebar membership across accounts

Codex desktop can show the same local projects and conversations after an account switch while
leaving custom sidebar sections empty. In the SQLite-backed desktop state observed in 26.1120,
`sidebar-custom-sections-v3` belongs to an account-specific `electron-owner-atoms:<owner>` scope.
The project catalog and the custom section's project memberships are separate records.

Remote AI can optionally fill missing local project memberships when switching official accounts.
Existing target memberships always win: a project already assigned to any target section is neither
moved nor duplicated. This is an additive import, not continuous mirroring. Moving or ungrouping a
project in one account does not overwrite a deliberate layout in another account.

## Enable

This initial compatibility feature is an advanced local preference, disabled by default; no UI
control is added. Fully quit Remote AI before editing its application data `settings.json`, add
`"codexSidebarSyncEnabled": true` to the existing object, and reopen Remote AI. The application data
directory is the one exposed by Settings, normally `%APPDATA%/dev.codex.switch` on Windows.
Do not replace the rest of the settings file.

Use the existing official-account **switch and restart ChatGPT/Codex** action. Remote AI stops
the desktop before merging the saved memberships and replacing its credentials. The backend is
shared by the local desktop and hosted web account-switch actions. This feature does not change
Remote AI's private Codex GUI workspace.

Hot proxy routing retains its existing behavior and does not merge sidebar state. Plain account
switches only merge when the desktop is already stopped. If a desktop is still running, Remote AI
skips this optional step and records `sidebar_sync_skipped_desktop_running` in its backend log.
Credential refreshes and switches to the same identity do not merge.

## Compatibility and conflict rules

- The current adapter supports `.codex-global-state.sqlite` and the owner-scoped
  `sidebar-custom-sections-v3` representation. It does not modify the old
  `.codex-global-state.json` migration snapshot or the older `inactive` account snapshot format.
- The source must match the database's current renderer owner. Owner keys use SHA-256 of compact
  JSON `[userId, accountId]`, as observed in Codex desktop 26.1120. Both identity fields must be
  present in a supported ChatGPT credential; API keys and opaque identities are skipped.
- Only `codex:project:<id>` items registered in the same home's `local-projects` catalog qualify.
  Remote-only sections, unregistered projects, thread items and ChatGPT cloud projects are excluded.
- Sections match by `hostSectionIds.local`, never by their display name or account-specific
  renderer ID. A missing section receives a new renderer ID and only its local host association.
- Target membership, pinned projects, ordering, collapsed state and unrelated fields are preserved. New sections
  are inserted before the ordinary Chats/Threads section. Explicit section deletions and pending
  local item removals are respected.
- Each configured external Codex Home is handled independently. No metadata crosses homes or is
  uploaded, and no conversation ownership, OAuth credentials or cloud access checks are changed.

This relies on a private, version-dependent Codex storage representation. Missing or unsupported
state is left alone. Invalid layouts, a locked database, backup failures and write failures do not
partially update a layout; Remote AI logs a category-only diagnostic and continues the credential
switch. No account IDs, paths, tokens or project names are included in these diagnostics.

## Backup and recovery

Every nonempty merge first writes a private, uniquely named JSON backup under
`<CODEX_HOME>/sidebar-sync-backups/`. It records the target `scope`, `key` and exact `previousValue`.
The source row is never changed. The target row and its owner marker are committed in one SQLite
transaction; backups are kept locally and are not part of Remote AI's cloud sync.

To undo a merge, fully stop Codex, open the named database with a SQLite client, and restore that
`settings` row's `value` from `previousValue` using bound parameters. If `previousValue` is null,
delete only the indicated `(scope, key)` row. The empty owner marker may remain. Do not clear the
database or replace unrelated account state. Backup files contain private layout metadata and
should stay on the user's computer.

## Verification

Tests use synthetic, unusable credentials and temporary homes; they never stop a real desktop or
write the developer's Codex state. The focused harness compiles the production module directly:

```powershell
cargo test --manifest-path scripts/sidebar-sync-harness/Cargo.toml --lib
cargo clippy --manifest-path scripts/sidebar-sync-harness/Cargo.toml --tests -- -D warnings
```

Run the same tests in the full desktop crate with:

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests codex_sidebar
npm run check
```
