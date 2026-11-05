# CUA Computer Use for Codex GUI

Remote AI's community marketplace includes **Computer Use 电脑助手**. It installs CUA Driver
0.37.0-remoteai.3 (based on upstream 0.37.0) for the selected Codex Home and exposes its native tools through STDIO MCP.
The installer supports Windows x64/ARM64 and macOS 13+ on Intel and Apple Silicon. macOS uses the
pinned universal binary archive. Older macOS versions and other operating systems show an unsupported state.

## Use

1. Open Codex GUI in the Windows or Mac desktop application. On its first connection, **Computer Use 电脑助手**
   is automatically installed in the GUI's private Codex Home before the conversation service starts.
   The first installation downloads the pinned package from Remote AI's GitHub Releases;
   the GUI shows a preparation notice.
2. Other Codex Homes can still install the assistant from the community plugin page.
3. Send a message in Codex GUI using the same Home. For example: “打开计算器，计算 6 × 7，并确认结果。”
4. The model can discover CUA tools, inspect applications, operate their controls and receive screenshots.
   The existing GUI tool-result viewer renders the MCP image content directly.
5. Use **停用** to stop that Home's sessions, **启用 / 修复** to restore its setup, or **卸载** to remove
   its managed MCP configuration and skill. Changed tools load before the next message in existing GUI conversations.

After updating Remote AI, desktop startup automatically prepares its pinned CUA release for all
enabled managed Homes. Opening Codex GUI also checks for an upgrade before its conversation service
starts. Disabled or uninstalled assistants stay that way. A failed upgrade retains the user's enabled
choice and retries on the next app launch or GUI connection; no manual reinstall is required.

Status checks restore missing managed configuration and skills for enabled installations whose local
driver package is complete. They do not download a package, change session credentials, enable a disabled
installation, or replace a foreign configuration. Checks serialize with installation changes on a worker.

An enabled card means the files and configuration are present, not that a particular conversation has
completed an MCP handshake. Driver startup failures remain visible as tool/connection errors in Codex.
Windows secure desktop, UAC prompts and elevated applications remain subject to Windows and CUA's limits.

### macOS permissions

Open the computer assistant card on the community plugin page and use **去开启** beside each missing
permission. In **System Settings → Privacy & Security**, enable **Accessibility** and **Screen Recording**
(called **Screen & System Audio Recording** on newer macOS versions) for **Remote AI**. These let the
assistant operate apps and inspect screenshots. The buttons request the corresponding macOS permission
and open its settings page; only the user can grant it. Reopen the conversation afterwards, and restart
Remote AI if macOS asks you to quit it. Status polling never requests a grant or captures the screen.

The managed driver inherits the app's TCC responsibility through its child-process chain and uses
`CUA_DRIVER_HOST_BUNDLE_ID=dev.codex.switch` for attribution. It does not install or start a separate
`CuaDriver.app` daemon. When developing or running the opt-in protocol script from a terminal/IDE,
macOS can attribute permission to that launching app instead. Grant that app access for the test;
verify the packaged Remote AI separately. Direct MCP mode has no macOS cursor overlay/PiP facility;
use screenshots to verify desktop actions.

## Lifecycle

- First-time setup runs on a blocking worker and shares the manual installer's serialization guard.
  A per-home marker survives uninstall; first-time setup is attempted once, and a failed first install
  remains repairable from the community plugin page. Enabled installations upgrade independently of
  this marker, including legacy records without a version. A successful upgrade records the new
  version, refreshes the managed configuration and skill, and revokes the old generation.
- Automatic upgrades download and verify the package before committing per-home changes, without
  holding the settings guard during the download. A separate package guard coalesces preparation
  across Homes. The generation is rechecked before committing, so a concurrent disable, removal, or
  reinstall wins. Failed downloads leave existing configuration and the enabled choice intact.
  Unsupported platforms skip setup; headless startup and browser connections never trigger it.
  Upgrades do not trigger installation of the separate unattended desktop service.
- `computer_use` owns installation, records, downloads and process lifecycle in separate Rust modules.
  Both Tauri commands delegate blocking work to worker threads. Status polling only checks local files
  and serialized configuration; it neither starts a driver nor scans applications. The frontend permits
  one status request at a time and ignores stale responses after actions or unmounting.
- The release version and each package's official SHA-256 are pinned in code. Downloads are bounded,
  verified before extraction, and extracted through an exact filename allowlist into a staging directory.
  The installer uses the application's proxy configuration. It does not execute the upstream installer.
- Binaries live under `%LOCALAPPDATA%/dev.codex.switch/computer-use/0.37.0-remoteai.3-windows-<architecture>`.
  On macOS they live under `~/Library/Application Support/dev.codex.switch/computer-use/0.37.0-remoteai.3-darwin-universal`.
  The flat macOS tarball is extracted through a filename allowlist; executable bits are restored,
  while links, duplicates, missing members and oversized files are rejected.
  They are shared only as cached files. Uninstalling one Home retains this cache for other Homes and
  future reinstalls; it does not modify a separately installed CUA Driver or the user's PATH/autostart.
- Each Home gets a `codex_switch_computer_use` MCP entry pointing to the current Remote AI executable
  with `--computer-use-mcp=<home-hash>`, plus the managed `codex-switch-computer-use` skill.
  Existing unrelated settings and user-authored same-name skills are preserved; conflicts fail explicitly.
- The helper launches `cua-driver mcp --direct`, so each connection owns its native runtime instead of
  borrowing a global daemon. It uses the default `standard` permission mode, supplies no browser-profile
  grants, and disables CUA telemetry using `CUA_DRIVER_RS_TELEMETRY_ENABLED=0`.
- Records carry a driver version, an enable flag and a generation. The helper checks them every 250 ms; disable, reinstall
  or removal revokes the previous generation and ends its process. Rapid re-enable cannot revive an old
  connection. This stops subsequent control; it cannot undo actions already performed. Normal stdin EOF
  and installer shutdown also end the session.
- The managed desktop commands are not exposed through the hosted web API. A remote browser cannot use
  this marketplace card to install desktop control on its server.

## Driver workflows

The managed skill uses fresh `element_token` references and incremental window reads with
`since:"latest"`. `run_steps` batches known actions with one final observation; `run_script` supports
bounded conditional flows in the driver's sandbox. `get_guide` supplies version-matched instructions.
The built-in help assistant also exposes these three tools, with a 150-second request timeout to
allow the driver's maximum 120-second script budget. Chrome routing and Remote AI's macOS permission
ownership remain unchanged. Optional visual parsing models are not installed by the integration.

## Portable source bundle

`apps/desktop/src-tauri/resources/codex-switch-computer-use` also contains a validated Codex plugin
manifest, MCP companion file and skill. Its standalone MCP config expects an independently installed
`cua-driver` on PATH. The desktop marketplace uses its own managed launcher and per-home lifecycle above;
it does not automatically register this source bundle in OpenAI's official plugin marketplace.

## Verification

```powershell
npm run build:desktop
npm exec -w @codex-switch/desktop -- vitest run --pool=threads src/pages/skillsMarket/ComputerUseCard/useComputerUse.test.tsx src/pages/codexGui/ConversationDetails.test.tsx
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --bin csw
$env:CSW_CUA_DRIVER_DIRECTORY = '<verified extracted CUA 0.37.0-remoteai.3 directory>'
$env:CSW_CUA_CODEX_BINARY = '<GUI-managed codex.exe path>'
node --test scripts/computer-use-protocol.test.mjs
```

The opt-in protocol check uses temporary Homes and the actual CUA executable. It checks initialization,
tool discovery, batching guidance, sandboxed script execution, incremental-read schemas, application
listing, screenshot image blocks, per-home revocation and a disabled startup.
When the Codex binary is supplied, it also verifies tool discovery through an ephemeral app-server
conversation. It does not require a model request or change the user's Codex Home. Unit tests cover configuration
preservation, conflicts, failed download recovery, generation revocation and corrupt archive rejection.
Upgrade tests cover legacy records and markers, multiple Homes sharing one package, failed-download
retry, later version changes, and disable/removal/reinstall while a download is in flight.

On macOS, build the debug `csw` binary, then run the same protocol script with these variables set:

```sh
export CSW_CUA_DRIVER_DIRECTORY='<verified extracted CUA 0.37.0-remoteai.3 universal binary directory>'
export CSW_CUA_CODEX_BINARY='<GUI-managed codex path>'
node --test scripts/computer-use-protocol.test.mjs
```

Grant desktop permissions to the launching terminal/IDE before running screenshot checks. Validate the
packaged app on a Mac separately: install, grant both permissions from the card, open a new conversation,
inspect a screenshot, operate Calculator, and disable one Home while another session remains connected.
Native macOS CI checks compilation, installation logic and Unix executable permissions on both architectures;
it does not grant TCC permissions or claim an interactive desktop test.

## Upstream

- [CUA source and MIT license](https://github.com/trycua/cua)
- [Pinned Remote AI driver release](https://github.com/piperhex/remoteai/releases/tag/cua-v0.37.0-remoteai.3)
- [Independent CUA package and release workflow](../packages/cua/README.md)
- [Driver integration boundaries](https://github.com/trycua/cua/blob/cua-driver-rs-v0.37.0/libs/cua-driver/README.md)
- [Windows MCP tools](https://cua.ai/docs/reference/cua-driver/mcp-tools-windows)
- [macOS MCP tools](https://cua.ai/docs/reference/cua-driver/mcp-tools-macos)

CUA is developed by Cua AI, Inc. Remote AI supplies this integration; it is not the OpenAI
Computer Use plugin. Packages are downloaded from the pinned `cua-v*` release in `piperhex/remoteai`,
with SHA-256 values embedded in Remote AI. Windows CLI/SDK binaries include the native-app token
compatibility patch for UAC-disabled hosts; companion binaries and the signed macOS runtime retain
their upstream bytes. Isolated-browser token handling is unchanged. Existing enabled 0.37.0 installs
automatically migrate to the downstream package when Remote AI is updated.

Driver source and its build dependencies are committed under `packages/cua/vendor`, including the
compatibility fix. A normal clone includes this source; package CI builds directly from it and
verifies `source-lock.json`. Upstream source is no longer cloned during the package build.
