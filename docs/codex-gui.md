# Codex GUI

Codex GUI is the chat workspace embedded in Remote AI, available in the desktop app and its hosted web UI.
Its navigation entry appears immediately after
Providers (三方模型及中转). It supports project folders, text and image input, model and reasoning selection,
streamed Markdown replies, command output, file diffs, plans, permission approvals, questions, interruption,
history, search, renaming, pinning, and archiving/restoring conversations.

Each submitted message includes a snapshot of other running GUI conversations. Type **@** to search for
another conversation and attach its recent messages as context. See [conversation awareness](codex-gui-conversation-awareness.md)
for scope, limits and verification.

The GUI account picker includes official accounts, custom Providers, and upstream Remote AI Providers.
Codex GUI remembers its own account independently of the account manager and other applications. The first
visit starts with the current supported account; later switches and restarts preserve the GUI's choice.
GUI connections start automatically, even when the external proxy is off. A GUI account switch applies
to subsequent requests without interrupting an existing reply. Shared automatic fallback and concurrent
account routing do not change the GUI's selected account.
The GUI's remaining quota and Provider model choices follow its own selection. All connected GUI browsers
share this selection, and upstream Remote AI Providers continue to use the live Codex model catalog.

The **今日** cost is a daily estimate across recorded requests. For official Codex accounts, each request
uses the speed selected when it was sent; Fast mode applies the configured multiplier (2.5 by default).
GUI Fast mode is independent of the external proxy and affects subsequent GUI requests only. Both
connections use the same Token usage database and accounting. A generic `default` tier in an official Codex response does
not remove that request's Fast-mode estimate. API Providers use the reported response tier when available,
including a downgrade to normal speed. These estimates are not a statement of actual subscription charges.

In the desktop app, the account bar also shows the selected computer. Open it and choose **切换电脑**
to select **本机** or another online computer signed in to the same Remote AI cloud account.
The conversation list, messages, project selection, model settings and account choices then belong to
that computer. Use **切换账户** in the same menu to open its account list and select an official account
or Provider. GUI account selection does not require enabling the target computer's external proxy.
Its account selection is shared with other clients connected to that computer.

Switching computers leaves existing tasks running on their original computer. Returning to **本机**
restores the local GUI workspace. An interrupted remote connection shows its connection state and retries;
it never redirects messages or account changes to the local computer. Offline computers remain visible
but cannot be selected. Logging out or changing cloud accounts closes the previous remote workspace.
Cloud credentials and token renewal stay in the native desktop backend; the UI exchanges public peer
keys and encrypted chat frames through the existing direct connection and relay protocol.

The desktop remote workspace uses the viewing computer's GUI font size and Dream Skin appearance,
including dark themes. Its project sidebar, recent/archived filter, message spacing, project bar and
composer follow the local GUI layout. The header can reconnect remote Codex, check and update its CLI,
open a remote terminal, and toggle the current conversation's file changes in the right sidebar.
Both computers need a version of Remote AI that supports these tools. CLI installation and terminal
commands run on the selected remote computer over the existing authenticated P2P or Relay connection.
Updates show download progress and refuse to start while that computer has an active GUI task.
Terminals start in the current remote project, support multiple tabs and resizing, and close when the
remote session ends. Hiding the terminal panel keeps its shells running. A started CLI download continues
if the viewer disconnects; reconnecting shows its current status.

The first button at the right of the conversation header opens **工具箱**. On **本机**, it only shows **Git**
for the current local project. On a remote computer, it shows **远程桌面** and **Git** for that computer.
Remote desktop opens its Windows primary display with mouse and keyboard controls.
Terminal keeps its existing separate header button and is not duplicated in the toolbox.
Leaving the workspace closes the desktop viewer and releases control.

Desktop web chat and the PC remote workspace use the same file-change cards and right-side diff panel
as the local GUI. Cards show per-file line counts, initially list three files, and expand in place.
Click a file to review only that path, or **审核** to review the whole turn. The panel supports highlighted
code, unified and side-by-side views, resizing, minimizing and expanding. Incoming changes update the
current review without switching the selected file. Remote file paths open their diffs on the selected
computer. Mobile web chat keeps its compact diff drawer; resizing the browser preserves unsent drafts.

Screenshot paste and copied image files both add image previews before sending. Copied files are read
off the UI thread and sent as image bytes, never as paths on the viewing computer. Relay image preparation
uses inline data URLs compatible with the packaged WebView image policy. The send button waits for
clipboard reads to finish; changing computers or conversations discards late clipboard results.
QQ mixed image/text copies are recognized through their HTML image references. Local and remote desktop
composers keep the accompanying text, and the remote workspace uploads the copied images from the viewing
computer. Web chat accepts image files and embedded images with their text. If the browser exposes only
local image URLs, it keeps the text and asks the user to copy the images separately or save and attach them.
Switching computers keeps the local workspace mounted so its running reply and unsent draft survive.

The gear in the local account list opens **Codex GUI 设置**, with top tabs for **自动切号**,
**界面**, **主题**, and **皮肤**. The appearance tab changes the conversation font size from 12–24 px (14 px by default),
with an immediate preview and a reset button. Messages, the composer, code, tool output, and file diffs
follow the saved size; other Remote AI pages keep their own typography. Font changes are saved locally
as soon as they are made, independently of account settings.

The skin tab reuses the built-in, community, and saved images from the existing skin page.
Selecting an image applies it only to Codex GUI, with an independently saved overlay opacity.
Community images are downloaded into the shared library without applying or restarting the external skin runtime.
Users can also disable the GUI background or follow the skin page, which remains the default for existing users.
Independent choices survive restarts and are unaffected when the shared skin is changed, paused, or restored.

Successful top-level GUI turns send a native desktop completion notification, including when another conversation
is selected or the app is minimized. On Windows, these appear in the system notification area at the
bottom right, subject to the user's system notification settings. Failed, interrupted, and duplicate
completion events do not send notifications. Subagent turns never send desktop completion notifications;
the parent conversation notifies when its own turn finishes. If thread metadata cannot confirm a top-level
conversation, the notification is skipped. User-created conversation forks still notify normally.
Delivery runs outside the UI and protocol reader threads.

Tool connections belong to a loaded conversation, so one conversation can own separate Chrome,
computer-use and remote-command helper processes even between tool calls. The shared desktop backend
checks subscriptions every 30 seconds and releases them after at least 60 seconds without activity.
It first confirms that the conversation is idle, has no active goal, approval, background terminal or
queued engine submission. Unknown states or failed checks leave the subscription intact for retry.
Sending, resuming and context changes are serialized against cleanup; reading history does not renew
the subscription. Desktop, hosted web and phone clients all use this same lifecycle.

Unsubscribing preserves conversation history and allows the engine to reclaim its tools after its own
inactivity grace period (30 minutes in Codex 0.158.0). It does not kill helpers after each tool call.
The next message resumes the conversation and restores its tool connections. The Chrome extension's
native messaging host is a separate connection and stays alive while Chrome is connected.
See the [app-server lifecycle](https://learn.chatgpt.com/docs/app-server#unsubscribe-from-a-loaded-thread).

Automatic switching is off by
default and has its own account membership, priorities, quota thresholds, exhaustion toggle, fallback
Provider, and sequential/concurrent mode. New accounts participate by default after it is enabled;
these choices never edit the account manager's rules. The list follows the width of the account bar below.

Sequential mode keeps the current account until it is excluded, its primary quota falls below the larger
of the default/account thresholds, or quota exhaustion requires a replacement. Smaller priority numbers
come first; equal priorities prefer the smaller positive remaining quota. Concurrent mode keeps an eligible
account assigned to each conversation and distributes new conversations among the highest-priority available
accounts. With no eligible account, the configured fallback Provider is used; a manually selected Provider
stays selected. A normal temporary rate limit retries without rotating accounts. Once a reply has streamed,
it is never replayed on another account. Settings are saved in `codex-gui-auto-switch.json` and survive restart.

**Codex GUI 设置 → 系统提示词** manages GUI-only filtering and injection rules. Changes are saved immediately
in `codex-gui-system-prompts.json` and apply to the next request, including requests in existing conversations.
Filtering runs before injection; an active request keeps the rules it started with. GUI rules start disabled
and do not inherit or change the shared proxy rules. The shared **系统提示词** entry is available from the
**工具箱** in **账户管理** and **三方模型及中转**, rather than as a main navigation item.

Quota refreshes run outside settings and selection locks. A manual account change or a settings save
invalidates older automatic decisions, so a slow refresh cannot overwrite the newer choice. Confirmed
exhausted accounts stay excluded until a later successful quota refresh shows usable quota again.

Opening or reopening a conversation displays its latest ten messages. Scroll upward to load ten earlier
messages at a time; a loading indicator appears and the current reading position is preserved.
Incoming replies continue updating while browsing history.
Processing details and their screenshots load when expanded. Long tool outputs appear in short pages;
**复制完整内容** copies the complete output regardless of the page being viewed.

Type `/` in the message box to choose a command or skill. **压缩** (also searchable as `/compact`)
compacts the current conversation's context and shows its latest context usage when available.
Select it with the mouse or Enter/Tab; it runs directly without sending the command as a message.
Wait for the current task and queued messages to finish before compacting. Progress appears in the conversation.

Choose **删除** from a conversation's menu to move it to the session manager's recycle bin.
In **会话管理**, select **内置 Codex GUI** as the source home and open **回收站**. Select conversations
and a destination under **恢复到 Codex Home**, then restore. Existing conversations in the destination
are skipped. Initialize the destination with a compatible Codex version first; if its conversation
storage cannot preserve the complete history, the backup stays in the recycle bin for retrying.
Conversations with active replies or queued messages cannot be deleted until those are handled.

Use **+** to add files, folders, or an installed and enabled plugin. File and folder selections add references
to their full paths; the selected access mode still controls what Codex can read or edit. The hosted web UI
accepts paths on the Switch host. Plugin selections stay attached to the draft and are included when sending,
including queued messages and steering. Plan mode is not included in this menu.

In the desktop app, click or right-click a file link or an edited-file name to open its file menu.
**打开方式** lists recognized local editors and terminals; Windows also offers **其他应用…** to open
the system application chooser. The menu supports opening with the default app, saving a copy, copying
the absolute path or text contents, and revealing the file in the file manager. Edited-file menus retain
**查看差异**, and **审核** still opens the complete diff. VS Code and JetBrains editors retain supported
line references. Relative paths resolve against the conversation's actual workspace, including projectless tasks.
Text copying accepts UTF-8 files up to 2 MB. Application discovery and file I/O run on background workers.
These native actions are desktop-only; browsers retain path copying and diff viewing.

Choose **+ → 目标** to describe a result and start working toward it. Goals are saved with the conversation;
Codex continues until the goal is completed, paused, blocked, or reaches a usage limit. Click the goal above
the input to edit, pause, continue or remove it. **停止生成** pauses an active goal before stopping its current
reply. Goal progress comes from Codex itself and survives reopening the conversation.

Paste images directly into the message box with Ctrl+V (Cmd+V on macOS), or choose **+ → 文件和文件夹 → 添加图片**.
Attachments appear as thumbnails above the text, each with a remove button. A message can contain up to eight
PNG, JPEG, WebP, or GIF images, at most 20 MB each, and can be sent without text. Failed sends retain the draft
and its images for retrying; switching conversations keeps each draft separate.

Selecting a project is optional. Hovering a selected folder reveals a removal button on its left; removing
the selection leaves the actual folder intact and applies to the next message. Project changes are disabled
while a turn is running. Projectless conversations appear under the “无项目” group.

## Scheduled tasks and plugins

The GUI sidebar includes **定时任务** and **插件**. Switching pages keeps the current conversation and unsent draft.
Scheduled tasks support one-time, interval, daily, weekday, and weekly schedules, with search, status filters,
editing, pause/resume, immediate runs, and links to the latest task conversation. Suggested tasks prefill the editor.

Tasks run while the Switch host is open and use that computer's local time. Each execution creates a separate GUI
conversation with the usual workspace permissions and approval flow. Missed repetitions are combined into one run;
a running task cannot overlap itself. Tasks are stored in the GUI home and resume scheduling after app restart.
Task management is available in the desktop app and localhost web interface; it is not exposed to LAN clients.

The compact plugin market reuses community plugins, official plugins, and system prompt plugins. Community,
official, and built-in plugin operations always use the private GUI home, without a directory selector.
System prompt plugins retain their existing shared proxy scope, which is explained in that tab.

## Browser conversations

Open the web address provided by the running Remote AI host, then choose **Codex GUI**. The same page is
available when Switch runs with `csw --headless --port=18080`. A standalone frontend preview has no conversation
backend; the separate cloud account-sync client under `/web/` is not this hosted interface.

File links open in the same preview sidebar as the desktop app, including text/code, Markdown, HTML,
images, PDF, audio and video supported by the browser. Markdown images and HTML resources can load from
the selected file's directory. Previews work on localhost and authenticated LAN connections, including
headless hosts. Closing a preview releases its file access; abandoned previews expire after one hour
without file requests. Opening host applications and showing files in the host's file manager remain
desktop-only actions.

Codex is installed and runs on the Switch host. Conversations, accounts, model configuration, tools and project
files all belong to that host; nothing needs to be installed on the device running the browser. If Codex has not
been installed on the host, use **下载并开始** on the page. For a project, enter the full folder path on the host,
or leave the project empty. Browser messages must fit the web interface's 8 MB request limit, including encoded
images; reduce image sizes if a message exceeds it. Failed sends preserve the draft.

For another trusted device, enable LAN listening and enter the web access key. An authenticated browser can start,
continue, interrupt and manage GUI conversations, answer permission requests and install Codex on the host.
The selected Codex access mode and approval flow still apply. Host administration remains restricted, including
changing the proxy's fast mode from a remote browser. All connected browsers share the host's GUI workspace.

Replies, permission requests and download progress arrive through the authenticated web interface. Interrupted
connections retry and refresh conversation state. Leaving the page stops browser polling; tasks keep running on
the host and reconnecting loads their current state.

## Installation and storage

Every entry into the local Codex GUI tab checks [official Codex Releases](https://github.com/openai/codex/releases)
and silently downloads the latest version. Checks and downloads do not interrupt conversations; background
failures are retried on the next visit. A verified update is activated when Remote AI next starts, even offline,
or when the user clicks the update button. Manual updates check again for a newer release before activation.
The newest discovered version replaces any previous pending update, including while a download is in progress;
an incomplete newer download never falls back to activating an older pending version.

The installer chooses the current platform's complete `codex-package` archive, checks its size and GitHub
SHA-256 digest, and extracts into a staging directory before marking it ready. The first installation also
requires clicking **下载并开始** or restarting after the download finishes. Earlier version directories are retained.
The app's network proxy settings also apply to downloads. Remote computer updates remain manually controlled.

On the local desktop, **手动下载** beside the version check opens an offline installation guide. It provides
official links for the current platform's complete `.tar.gz` package and release metadata (save the JSON page
as a file, without renaming it). File names and extensions are unrestricted; validation uses file contents.
Select the complete package and choose **导入并安装**; the release verification file is optional and can be
removed after selection. No network request is needed during import. Without release metadata, the bundled
`codex-package.json` identifies the version and platform; import validates the package layout and gzip integrity.
When metadata is supplied, its expected size and SHA-256 digest must also match; failed verification is never
silently skipped. Import preserves the original downloads and rejects older or incompatible releases.
First installation activates immediately; updates use the existing idle activation flow or wait until the
next launch. An unfinished automatic download does not block offline import. This file picker is local to
the desktop; when using a remote computer, perform the import in Remote AI on that computer.

Both the executable and the conversation data live under the Tauri application data directory (`dev.codex.switch`):

```text
dev.codex.switch/
├── codex-cli/
│   ├── installed.json
│   ├── pending.json        # Newest discovered update; activated only when its package is complete
│   └── <version>/
│       ├── bin/codex[.exe]
│       ├── codex-resources/
│       └── codex-path/
├── codex-gui-workspaces/     # Separate scratch folders for projectless conversations
└── .codex/
    ├── config.toml
    ├── auth.json
    ├── sessions/
    ├── archived_sessions/
    ├── state_*.sqlite
    └── log/
```

On Windows this normally resolves to `%APPDATA%/dev.codex.switch`. Initial Codex preferences are imported once;
GUI account selection is stored separately in `codex-gui-account.json`. GUI requests use a dedicated local
proxy route, and reconnecting does not import another application's authentication. The GUI home is excluded
from shared account and Provider synchronization. Official conversation files, indexes, and databases are
never imported or edited. SQLite and log locations are overridden on the private process command line, even
if the imported configuration specifies other locations. Reconnect after editing Codex configuration.
Recent folders, pins, and per-conversation project choices are UI preferences stored in the Switch WebView;
message content stays in `.codex`. Scratch folders are excluded from project labels and recent folder choices.

The GUI enables `features.api_key_model_discovery` and sets its private Provider's `model_catalog_url`
to the GUI proxy's `/models` endpoint. New upstream models therefore arrive with their advertised
capabilities instead of depending on the CLI's bundled catalog. The endpoint follows the GUI account
selection, independently of the shared account manager. Switching GUI accounts expires the CLI's catalog
cache; slow model responses from a previous account are rejected. Other refreshes follow Codex's cache lifetime.
The shared desktop/phone/Web composer copies the CLI catalog every minute, after account changes,
and when the desktop model menu opens. Refreshes are single-flight, preserve the previous list on failure,
and do not restart running conversations. Leaving the shared GUI session stops refresh subscriptions and timers.

Provider catalogs are resolved by the shared GUI session from its persisted account selection, including
when the PC is showing another page or a remote computer. Switching sources blocks new sends until the
catalog and conversation choices are synchronized; a failed switch refresh keeps sends blocked until a
successful refresh. Phone and Web receive the same synchronization state. Removed models fall back to the
new catalog's default, with the resolved choice saved for every observed, running, and queued conversation.
Running tasks receive the existing live-settings update, and queued sends recheck a source change that
occurred while resuming. Requests already dispatched are left to finish.

Run `node scripts/codex-gui-model-catalog-smoke.mjs <installed-package>/bin/codex.exe` to verify proxy
discovery, hidden-model filtering and cache expiry against a local fixture without using model credits.

Third-party Provider model catalogs default to `use_responses_lite = false`, including OpenAI-type
Providers that relay an upstream catalog. The compatibility default is reapplied on every model-list
refresh. Official account catalogs keep their advertised capabilities. An explicit `model_catalog_json`
in the GUI's own `config.toml` is preserved on reconnect; the initial import excludes the shared catalog
because it can describe a different account. GUI startup overrides for SQLite, logs and features do not
override this catalog. Users who have verified their Provider's Lite support can opt in through that
explicit catalog. Existing customized generated catalogs also retain their Lite setting on refresh.

Every outgoing Lite Responses request is checked for `reasoning.context = "all_turns"`, including resumed
conversations and compaction. Missing or conflicting context is repaired without replacing the other
reasoning options; malformed requests are rejected before transport or protocol fallback. The Lite
header is retained because Lite also changes the input and tool structure. Diagnostics record the Lite
flag, reasoning context and repair events without logging conversation text. If a gateway subsequently
drops the context field, its request forwarding must also be corrected.

Run `node scripts/codex-gui-responses-lite-smoke.mjs <installed-package>/bin/codex.exe` to check new turns,
automatic compaction, restart/resume and extra app-server `-c` settings against a local fixture.

## Architecture

The Rust `codex_gui` module runs the downloaded `codex app-server` using asynchronous stdio JSON-RPC.
Desktop and web clients invoke the same explicit operation enum. Web requests execute asynchronous commands from
the existing HTTP request worker. File validation, config synchronization, downloads,
and archive extraction run in blocking workers. The browser uses Switch's existing hosted HTTP endpoint.
The private child process is closed with the application; leaving the GUI page preserves live conversations.

The frontend batches streaming updates, correlates events by thread/turn/item, reconciles completed items with
streamed text, and keeps command/permission approval requests pending until the user responds. Unknown server
requests are rejected explicitly. This is a local workspace; cloud tasks, the official app's extensions and
remote-control features are outside this page's scope.

The desktop message view lazily mounts items, including processing activities and generated images.
Its ten-item window expands from a stable item cursor so live replies do not evict loaded history.
The controller retains complete turns for editing, continuation, and file review actions.
Collapsed process groups, individual activities, and structured payloads do not mount their contents.
Tool text is limited to 8,000 characters per page to bound Markdown parsing and DOM work for oversized records.

Browser event replay uses an independent cursor per browser, with a bounded in-memory log. Polls are single-flight,
shared between conversation and download subscribers, and never scan storage. Stale cursors and server restarts
trigger a state refresh instead of silently dropping stream fragments. Desktop events retain their native delivery.

The protocol was checked against `D:/github/codex/codex-rs/app-server-protocol` and the downloaded official
release. Tests use a local Responses fixture rather than a paid model.

## Verification

New conversations can search and switch local Git branches, create a branch, or create a local worktree
from the selected checkout's current commit. Worktrees live in the app data directory under `git-worktrees`;
the new conversation uses the new directory, while uncommitted files stay in the original checkout.
Checkout never uses force, and branches checked out in another worktree are marked unavailable.

Edited-file cards support undo after a reply finishes. The backend reads the selected turn's completed
file-change records, prepares inverse edits in a temporary directory, and checks every affected file before
applying them. Conflicts leave the workspace untouched; unrelated edits and the Git index are preserved.
Undo receipts survive reopening the conversation. Text updates require Git, including for folders without
a Git repository; unsupported changes and paths outside the conversation directory are rejected.
Git and undo commands run on blocking workers, with authenticated browser dispatch sharing the same implementation.

```powershell
npm test -w @codex-switch/desktop
npm run build:desktop
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests
npm exec -w @codex-switch/desktop -- playwright test --config playwright.chat.config.ts file-menu.pw.ts
```

The opt-in installer smoke test downloads and verifies a real release into a temporary directory:

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests `
  official_release_download_and_extract -- --ignored --nocapture
node scripts/codex-gui-smoke.mjs <downloaded-package>/bin/codex.exe
```

The protocol smoke test covers initialization, models, image-only input reaching the model request,
live deltas while listing conversations, persisted
history, rename, process restart/resume, archive/restore, compaction and context usage updates,
interruption, and independent on-disk storage.


## External proxy configuration isolation

The GUI home is excluded from external Codex configuration targets by directory, including
legacy saved entries and directory aliases. An inherited GUI `CODEX_HOME` cannot become the
external default. Storage also checks the complete target list against the application's GUI
home before returning writable paths, even if startup has not initialized the home cache.

Stopping the external proxy validates those targets before restoring account credentials and
official configuration. Both stop options share this restoration path. The private GUI listener,
account selection, authentication file and configuration remain separate.

The `proxy_config_restore_preserves_gui_files_and_active_reply` regression uses an isolated child
process with inherited and stale GUI paths. It applies external proxy configuration, holds a GUI
response open while polling sessions, stops the external listener and restores external credentials.
It checks GUI file bytes and modification times, completion of the active request and a subsequent
GUI request after the proxy is off. It uses a local mock upstream and never restarts real clients.

Verified on Windows on 2026-09-28: 1,379 Rust tests passed (9 opt-in tests ignored), 57 related
Home/proxy/GUI UI tests passed, Rust formatting and strict Clippy passed, and the desktop
TypeScript/Vite production build passed.

## Change models during a task

Changing the model or reasoning effort during generation updates the running task through
Codex's experimental `turn/settings/update` API. The next model request uses the new choice;
an already dispatched request finishes with its original settings. The task is not interrupted,
no extra user message is inserted, and existing child sessions retain their own settings.
The GUI enables `features.step_model_switching` when starting Codex and updates native thread defaults
so automatic goal continuations also retain the new selection.

A centered divider in the conversation shows the old and new model after Codex accepts the update.
Its information icon explains that the next request uses the new model and switching may slow responses.
Markers retain their chronological position when reopening the conversation in the same browser session.
If the task has already finished, the saved choice applies
to the next turn. An unsupported CLI or failed update displays a warning instead of claiming success;
the saved choice remains available for subsequent turns. Verified with Codex 0.154.0.

Run the local protocol fixture (no model credits required):

```powershell
node scripts/codex-gui-live-model-smoke.mjs <installed-package>/bin/codex.exe
```

## Website preview regression on Windows

Sidebar child WebViews must use `webview_windows::child_builder`, which copies the main window's
exact browser arguments. WebView2 instances sharing a data directory require matching environment
options; a mismatch can leave the preview blank and block native UI operations. Keep creation in an
async command with a blocking worker. The native fixture preserves the production window options.

Start the desktop Vite server on port 1489, then run from the repository root:

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests --no-run
node scripts/website-preview-smoke.mjs <path-to-codex_switch_lib_tests.exe-from-build-output>
```

The smoke script launches an isolated test app and a local website. It verifies page loading, host
selection, both dialog dismissal methods, queue buttons, native IPC, and preview cleanup after
minimizing, reloading and reopening. It stops its test process afterward. Port 1491 is reserved for
this test's WebView2 debugging connection (`WEBSITE_PREVIEW_DEBUG_PORT` overrides it).
