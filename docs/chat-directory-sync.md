# Scoped chat directory synchronization

This change separates directory summaries, query membership, sidebar metadata, image resources and
conversation history. The transport, reliable RPC framing, transport-v2 logical sessions,
`syncHistory`, field hashes and history pagination remain the existing implementations.

The implementation was checked against parent `9717d7e1d` and shared `93ebddd0f` at task start.
Concurrent completed fixes advanced the parent and shared branches during development. Generated
Native/Web dependencies are refreshed with the repository export tools, including their source hashes.

The reference was T3 Code's
[client shell](https://github.com/pingdotgg/t3code/blob/49c3ab86323444c3464f1404ace52017ccd7f83b/packages/client-runtime/src/state/shell.ts)
and [server shell stream](https://github.com/pingdotgg/t3code/blob/49c3ab86323444c3464f1404ace52017ccd7f83b/apps/server/src/orchestration-v2/ShellStream.ts).
Remote AI uses its existing RPC and engine adapters rather than adding that project's runtime stack.

## Source paths and ownership

| Path | Responsibility |
| --- | --- |
| `shared/chat/directory/` | Checkpoints, bounded journals, replica application, explicit summary DTOs, metadata documents, icon hashes and atomic cache envelopes |
| `apps/desktop/src/pages/codexGui/sidebarBridge.ts` | Authoritative presentation/read metadata and summary observations, archive membership, stale-read deletion protection |
| `apps/desktop/src/remoteChat/directory.ts` | Host-lifetime scoped views and replay, snapshot/event handoff, targeted missing-summary lookup |
| `apps/desktop/src/remoteChat/directoryGroups.ts` | Bounded group summary pages, including members inherited from assigned projects |
| `apps/desktop/src/remoteChat/operations.ts`, `host.ts` | Capability negotiation, per-session stream routing, lightweight mutation replies, legacy/new separation |
| `shared/remote-chat/client/directory.ts` | Scoped replicas, buffered live events, resume/reset, icon fetching and persistent data/checkpoint envelopes |
| `shared/cli-gui/`, `apps/desktop/cli-gui/directory.ts` | Claude/Gemini scoped lists and engine-qualified entries; SDK updates and timeline notifications remain distinct |
| `apps/desktop/cli-gui/host.ts`, `src-tauri/src/cli_gui/` | Preserve/coalesce notification payloads across Node, Rust and GUI events; validate the added request at IPC |
| Desktop/Web/Native sidebar entry points | Explicit group/CLI page controls and gesture-driven history paging |
| `apps/web/src/chat/useChat.ts`, desktop `useRemoteGui.ts`, Native `offline/directory.ts` | Account/device-specific browser or SQLite storage adapters |

The old amplification paths were confirmed: accumulated `known` sidebar snapshots, the same snapshot
attached to ordinary list responses, all explicit group members added to page one, and complete
Claude/Gemini lists requested during history polling. UI verification additionally exposed automatic
viewport filling repeatedly loading pages while folded groups continued showing only five rows.

## Protocol and lifecycle

The existing `connect` handshake negotiates `directorySyncV1`. New clients use `chatDirectory` with
`sync`, `page` and `icon` actions; updates arrive on `chat/directory/updated`. Each checkpoint includes
schema, host incarnation (`epoch`), a scoped view identity (`stream`), normalized query scope and revision.
The authenticated connection and persistent storage namespace provide the stable host/account identity.

1. **First connection:** read at most 50 Codex summaries (or a lower policy limit), relevant row metadata,
   group structure and loaded membership. A page document records the cursor and completeness.
   Register the stream, then replay to a high-water checkpoint to cover the snapshot/registration interval.
   Fetch missing icon hashes through authenticated RPC. Group members and transcript bodies are separate reads.
2. **Changes:** synchronously commit changed summaries/metadata and their log entry, then publish one batch.
   Batches carry `(from, checkpoint]` coverage, complete row upserts and removals. Unchanged metadata and icons
   are absent. Read/pin/group mutations return acknowledgements; the negotiated event path updates state.
3. **Paging:** append one bounded page to that view. Its request checkpoint binds the scope and data generation.
   The page response carries its changes without a second page broadcast. No cumulative sidebar accompanies it.
4. **Reconnect:** send the last applied checkpoint. A valid unchanged view returns an empty change batch.
   Otherwise replay coalesced changes. Expired logs, an unknown view, a future checkpoint, a schema/epoch mismatch
   or an invalid cache require a fresh bounded snapshot. The client performs one explicit reset fallback.
5. **State replacement:** host restart creates a new epoch. Index/SDK subscription rebuild discards affected
   stream identities. A transport socket reconnect or direct/relay path change does not recreate the host journal.
   An explicit user refresh can request a fresh bounded view; normal foreground/reconnect paths resume.

Journals retain at most 512 batches and 2 MiB per view. Codex retains at most 64 views; the CLI worker retains
at most 32. Clients retain up to eight query scopes per directory adapter. Icon caches are capped at 24 MiB.
The host still computes differences from its known summaries; the measured improvement concerns transferred
data, not a claim of constant-time host indexing.

## Membership, deletion and resources

`deleted` removes an entity; `outOfScope` removes membership in this view. Missing rows in a partial page
are never treated as deletion. Existing Codex pagination retains predecessor handling for removed anchors.
Group cursors bind the query and use stable ID boundaries, so deleting their anchor does not skip the next row.
Group membership changes invalidate affected group views and reload a bounded page. Search membership changes
also invalidate their query view, retaining the index's search semantics beyond a truncated preview.

Only loaded thread memberships accompany sidebar initialization. Assigned-project membership is scanned in
supported 100-row index pages on the host and returned as at most 50 summaries. Expanding visible content and
loading another backend page use separate controls. Load-more controls appear only inside expanded content,
after the loaded rows, and use text 1 CSS pixel smaller than the expansion control in browser hosts (one native
font unit smaller on Native, preserving system font scaling). Folded previews cannot trigger an unlimited initial drain.

Summary DTOs allowlist IDs, names, previews, projects, timestamps and status. Codex previews are at most 240
characters. CLI summaries omit permission prompts and retain their count; full prompts remain in history.
CLI keys contain both engine and session ID. Device/account isolation is enforced by each controller's store.

Existing inline PNG preferences remain the authoritative local format. Directory serialization replaces them
with SHA-256 references. Authenticated `icon` RPC reads populate a hash-checked cache that is persisted with the
directory. Unchanged reconnects and ordinary updates carry neither image bytes nor repeated resource requests.

## Claude and Gemini

Runtime status advertises `directorySyncV1`; capable engines accept `syncList` with archive/search scope,
checkpoint and paging intent. Legacy engines keep the existing `list` request. Ordinary network failures do
not select the legacy path. The service pages the SDK's owned-agent index, subscribes to index updates, and
maps them to the shared journal format. Removed or archived sessions update the corresponding engine views.
SDK subscription replacement invalidates the affected scope instead of certifying an incomplete cache.

Timeline events carry engine/session identity and refresh only the selected history. They do not repeatedly
request either full engine directory. Installation/runtime notifications and explicit metadata refreshes can
refresh low-frequency status; status is otherwise reused for 60 seconds. Model catalogs retain their existing
account/engine/project triggers. A Codex-only content view does not initialize external directories until the
mixed sidebar is actually used. Every sidebar retains an explicit path to older CLI pages.

The existing CLI ownership boundary is preserved: the SDK directory covers agents labeled `remoteai=cli-gui`.
Changes to those sessions observed through the SDK enter the stream. Arbitrary terminal-created sessions that
were never imported into that owned index are not a newly introduced data source in this task.

## Persistence and compatibility

Browser storage uses account identity, server URL and stable device ID; Native uses the same identity boundary
in SQLite. Each serialized cache envelope contains its data and applied checkpoint together, with a checksum.
Writes are serialized. Interrupted or failed writes leave an older complete envelope. A corrupt or incomplete
envelope cannot resume. Old account/device-generation responses cannot publish into a new controller.

New/new connections suppress legacy sidebar broadcasts. New/old connections use the explicitly absent
capability to select legacy behavior. Old/new connections retain legacy list/sidebar responses, including the
historical group supplement needed by those clients. RPC/event overlap is idempotent, and older responses
cannot lower an applied checkpoint. Transcript events and transport-v2 recovery keep their existing paths.

## Measured application traffic

These are **synthetic** fixtures with 100 or 1,500 sessions, one 16,022-character inline icon, older explicit
group members and two independent remote views. The legacy column serializes the retained legacy response/event
shape for the same warm catalog. The new column measures actual journal/request outputs. All values are UTF-8
JSON bytes before compression, encryption, packet framing or network transport. This is not WAN throughput.

| Operation | Legacy, 100 rows | New, 100 rows | Legacy, 1,500 rows | New, 1,500 rows |
| --- | ---: | ---: | ---: | ---: |
| Initial response, tail confirmation and first icon | 33,849 | 31,984 | 293,350 | 32,083 |
| Rename event | 26,369 | 648 | 178,969 | 649 |
| Running-state event | 26,368 | 649 | 178,968 | 650 |
| Read-state event | 26,418 | 420 | 179,018 | 420 |
| Unchanged resume | 33,888 | 226 | 293,389 | 226 |
| Next 50-row page | 30,137 | 19,376 | 182,846 | 19,485 |

Initial new loading uses three directory/resource requests: snapshot, high-water confirmation and one icon.
Its directory-only response bytes are 15,949/16,048; the one-time icon response is 16,035 bytes. Initial summary
count stays 50 instead of 100/1,500. Each measured ordinary change emits one event. Unchanged resume uses one
request, no events, no summaries and no reset. One recorded run measured host-call durations of 0.127/3.661 ms;
they exclude network latency and are not a latency guarantee. Paging emits no duplicate page event.

`src/remoteChat/directory.test.ts` writes reproducible measurements to
`.codex-tmp/directory-sync/traffic.json`. CLI tests use 1,200 synthetic sessions and verify 50-row engine pages,
zero SDK list calls during unchanged resume, engine-specific changes, removal/archive transitions and replay.
Compressed bytes, real relay/direct transfer rates and live paid-model execution were not measured.

## Validation and visual evidence

The protocol tests cover reset conditions, bounded logs, corrupt cache envelopes, serialized writes,
snapshot/live overlap, late responses, duplicate batches, covered sequence gaps, removal/archive semantics,
old group anchors, engine-qualified records, legacy/new negotiation and unchanged icon reuse.

Browser fixtures render the real local, remote and web components with labeled synthetic data at 14 px/light
and 20 px/dark/narrow settings. Android uses an isolated fixture application and a physical device at system
font scales 1.0 and 1.3; the original device font setting is restored. Fixtures do not send model prompts or
modify the user's conversations. iOS is validated by type checks and bundle export; no physical iOS run occurred.

Representative screenshots (all captures are under the indicated evidence directories):

| Platform / mode / state | Evidence |
| --- | --- |
| Desktop local / 20 px dark narrow / expanded pagination | [Screenshot](../.codex-tmp/directory-sync/screenshots/local-20px-dark-narrow-expanded-pagination.png) |
| Desktop remote / 14 px light / expanded pagination | [Screenshot](../.codex-tmp/directory-sync/screenshots/remote-14px-light-expanded-pagination.png) |
| Web desktop / 14 px light / expanded pagination | [Screenshot](../.codex-tmp/directory-sync/screenshots/web-14px-light-expanded-pagination.png) |
| Web mobile / 20 px dark / expanded pagination | [Screenshot](../.codex-tmp/directory-sync/screenshots/web-mobile-20px-dark-narrow-expanded-pagination.png) |
| Android physical / scale 1.0 / initial scope | [Screenshot](../apps/native/.codex-tmp/directory-sync/android-1-initial.png) |
| Android physical / scale 1.3 / expanded pagination | [Screenshot](../apps/native/.codex-tmp/directory-sync/android-1.3-expanded-pagination.png) |
| Android physical / scale 1.3 / SQLite cache resumed | [Screenshot](../apps/native/.codex-tmp/directory-sync/android-1.3-cache-resumed.png) |

The eight browser cases pass, including hidden paging controls in folded previews and a computed 1 CSS px
font difference at both preference sizes. The Android fixture passes at both system scales, including
single-row updates and reopening the client from its SQLite cache without retransmitting summaries.
Desktop's relevant Vitest run passes 279 files / 1,789 tests; Native passes 274 files / 1,515 tests.
Web passes its workspace tests and 4 Vitest files / 15 tests. Desktop and Web production builds, Native
type checks, boundary checks, localization checks and Rust formatting/Clippy also pass.
The full parent commit check passes, including 2,966 Rust library tests (41 optional tests ignored),
integration tests and installer checks.

## Delivered source revisions

| Repository | Revision | Content |
| --- | --- | --- |
| Parent implementation | `32b1ef76d` | Desktop hosts, local/remote integration, protocol tests and evidence report |
| Shared | `5022c3a` | Directory protocol, clients and paging controls; final fixture whitespace cleanup |
| Native | `974fd08` | SQLite persistence, expanded pagination and generated shared dependencies |
| Web | `1c423f7` | Browser persistence and generated desktop/shared dependencies |

Native's 1,169 and Web's 2,009 exported files pass their manifest hash verification. Compared with the
validated snapshots, only revision metadata and a trailing empty line in the Native test fixture changed.
Both manifests identify parent implementation `32b1ef76d` and shared `5022c3a`; Web also records Native
`974fd08`. Child revisions were pushed before the parent gitlinks were updated.

Browser command: `npx playwright test --config scripts/playwright.directory.config.ts` from `apps/desktop`.
Native fixture: build with `scripts/directory-sync.init.gradle`, then run
`ANDROID_SERIAL=<device> node scripts/test-directory-sync.mjs` from `apps/native`.
No production deployment, release publication or installation over the user's normal mobile app is part of this task.
