# Claude GUI and Gemini GUI

The composer footer selects the CLI for a new conversation. Existing conversations retain their original
engine. The footer displays that engine's installed CLI version on the selected computer; the Paseo runtime
version is never displayed as the CLI version. Codex's service status remains available beside its selector.

Desktop local, desktop remote and Web desktop use the same external conversation components. Each engine
supports text messages, streamed timelines, tool details, permission choices, questions, older history and
archiving. Archived conversations remain readable. This integration lists conversations created by Remote AI;
it does not import unrelated native CLI or Paseo sessions.

## Setup

Install and sign in to the chosen CLI on the computer that runs the conversation. The footer links directly to:

- Claude Code: https://code.claude.com/docs/en/setup#install-claude-code
- Gemini CLI: https://geminicli.com/docs/get-started/installation/

These links open the vendor's official installation instructions. They do not run an unattended installer.
After installation, refresh the CLI and model list. The worker checks PATH and standard user installation
directories. Node.js 22 or newer and npm are required to prepare the chat components. Windows builds prefer
the app's bundled Node runtime; npm can come from the user's Node installation.

Preparing chat components installs the exact `@getpaseo/server@0.15.4` release in the application's data
directory. Its configuration, conversation state and logs are isolated from the user's Paseo home. A private
loopback daemon with a random password runs inside the Node worker; public relay, web UI, MCP injection and
Paseo plugins and speech features are disabled. CLI credentials remain in each CLI's normal configuration.

## Implementation

- `apps/desktop/cli-gui` owns the public Paseo SDK adapter and JSONL worker.
- `apps/desktop/src-tauri/src/cli_gui` validates requests and manages the worker asynchronously.
- `shared/cli-gui` owns normalized contracts, state and UI.
- Remote requests reuse the authenticated chat transport's `cliGui` operation and existing event stream.

Every operation verifies the conversation's provider and Remote AI ownership. Approval responses must match
both a currently pending request and its exact provider action ID. Messages use client-generated IDs. Drafts
are separate for each conversation, and stale history responses cannot replace a newer selection.

The pinned public SDK exposes interruption through `agent.reload()`: Stop interrupts the current turn and
reopens the same native session with its history. There is no private SDK import. Runtime upgrades must verify
this behavior, the provider configuration schema and the projected-history cursor contract.

## Verification

Run the desktop build, `cli-gui/*.test.ts` using the desktop Vitest config, and `cli_gui` Rust tests plus Clippy.
`apps/desktop/scripts/smoke-cli-gui.mjs` starts the real daemon in `.codex-tmp/cli-gui-smoke`; it checks setup,
authentication, provider discovery and conversation listing without making a paid model request.
`test-cli-gui-acp.mjs` then exercises the real daemon against a deterministic ACP executable, including
permission round trips, restart history, interruption and archived history. Its executable and native
transcript files stay inside the same disposable smoke-test directory.

`apps/desktop/e2e/cli-gui.pw.ts` exercises the production local/remote/Web UI with controlled transport fixtures.
It covers per-conversation selection, distinct versions, exact approval choices, history, official installation
links, language switching, light/dark themes, 14/20 px font preferences and wide/narrow desktop windows.
Screenshots are written to `.codex-tmp/cli-gui-evidence`. Live model replies require separately installed and
authenticated CLIs; UI fixtures and daemon smoke tests do not establish that end-to-end result.
