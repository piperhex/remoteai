# Claude GUI and Gemini GUI

The composer footer selects the CLI for a new conversation. Existing conversations retain their original
engine. The footer displays that engine's installed CLI version on the selected computer; the Paseo runtime
version is never displayed as the CLI version. Codex's service status remains available beside its selector.

Desktop local, desktop remote and Web desktop reuse the existing conversation renderer, model picker,
project picker, approval styles and composer layout. Each engine
supports text messages, streamed timelines, tool details, permission choices, questions, older history and
archiving. Archived conversations remain readable. This integration lists conversations created by Remote AI;
it does not import unrelated native CLI or Paseo sessions.

## Setup

Choose the account or third-party provider in the existing GUI account picker, select a CLI in the composer
footer, then click Install. The application installs the vendor's official npm package and verifies its
executable version. It also prepares the private conversation runtime and npm automatically. Existing
system installations remain usable. The documentation links still point directly to:

- Claude Code: https://code.claude.com/docs/en/setup#install-claude-code
- Gemini CLI: https://geminicli.com/docs/get-started/installation/

The install/update button performs installation; the adjacent external-link icon opens the vendor guide.
Packages come from registry.npmjs.org in an application-owned directory. The npm bootstrap archive is checked
against its published SHA-512 integrity before safe extraction. Windows uses the app's bundled Node runtime;
other systems need Node.js 22 or newer. Version discovery prefers the managed installation, then PATH.

Installation includes the exact `@getpaseo/server@0.15.4` release in the application's data
directory. Its configuration, conversation state and logs are isolated from the user's Paseo home. A private
loopback daemon with a random password runs inside the Node worker; public relay, web UI, MCP injection and
Paseo plugins and speech features are disabled. CLI homes are private; users do not need separate Anthropic
or Google login sessions. Existing CLI authentication files are not modified.

## Accounts and models

Both engines use the existing GUI account selection, including internal accounts, third-party providers and
aggregate providers. The GUI account catalog supplies the model and reasoning options. Switching accounts
invalidates the catalog. Each message validates the selected model before execution.

The worker gives each CLI a private loopback endpoint and credential. Actual account credentials stay in
Rust. Claude Messages and Gemini GenerateContent requests enter the existing GUI Responses forwarding path,
which retains account switching, quota handling, provider protocol conversion and token-usage capture.
The CLI's native model alias does not choose the upstream model. A persisted conversation route stores the
actual selected model and reasoning setting, and survives worker restarts.

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
`apps/desktop/scripts/test-cli-gui-accounts.mjs` installs and runs the official Claude and Gemini executables
in `.codex-tmp/cli-gui-accounts` against a controlled account-proxy fixture. It verifies model selection and
real CLI replies without making paid model requests. Rust HTTP tests separately verify the shared GUI
provider route and credential isolation. `test-cli-gui-acp.mjs` exercises the real daemon against a deterministic ACP executable, including
permission round trips, restart history, interruption and archived history. Run it directly with
`node apps/desktop/scripts/test-cli-gui-acp.mjs`: it builds its own host and npm progress helper, installs
the pinned runtime in a new temporary directory, then repeats the scenario using that installation's cache.
No previous smoke run or readiness marker is required. Each pass has a deadline; the test cleans its own
processes and temporary directory without touching other smoke caches. Process failure and timeout coverage
runs with `node --test apps/desktop/scripts/cli-gui-acp-process.test.mjs`.

`apps/desktop/e2e/cli-gui.pw.ts` exercises the production local/remote/Web UI with controlled transport fixtures.
It covers per-conversation selection, distinct versions, exact approval choices, history, one-click installation,
official documentation links, language switching, light/dark themes, 14/20 px font preferences and wide/narrow
desktop windows. Screenshots are written to `.codex-tmp/cli-gui-account-evidence`. Actual paid account/model
responses are not established by the deterministic proxy fixtures.
