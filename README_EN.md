# Remote AI

> [!IMPORTANT]
> **Codex Switch is now Remote AI.** The repository has moved from `codex-switch` to
> [piperhex/remoteai](https://github.com/piperhex/remoteai). Update your bookmarks to follow future releases.

> Chinese is the default documentation language. For the Chinese README, see [README.md](README.md).

The interface opens in Chinese on Chinese-language systems and English on other systems.
You can choose English, Chinese, or Russian in Settings; your choice is remembered.

Remote AI is a desktop workspace built on Codex CLI, combining a graphical coding assistant with multi-account management.
Chat with Codex to understand code, build features, and troubleshoot problems while following progress and file changes.
It also includes account sign-in and switching, usage monitoring, third-party Providers, a hot-switching local proxy,
token analytics, a Skills Market, and one-click themes. Use its hosted browser UI or connect a self-hosted backend
and mobile companion to manage accounts across devices.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE) [![Release](https://img.shields.io/github/v/release/piperhex/remoteai)](https://github.com/piperhex/remoteai/releases)

## Codex Web

Open [Codex Web](https://codex.onepiper.cloud/web/) to connect to your computer and use Codex in your browser.

Before using it, install the [Remote AI desktop app](https://github.com/piperhex/remoteai/releases),
then open **Home** and follow the prompts to install Codex.
Keep the desktop app running and your computer online. Sign in to the web app with the same cloud account
as the desktop app, then connect to your computer to get started.

## Screenshots

### Codex GUI coding assistant

Codex GUI is the built-in chat workspace. Select a project and describe your task in plain language,
or ask a question without selecting a project. Keep projects, conversations, and changes together in one interface.

![Codex GUI project and conversation workspace](docs/assets/codex-switch-codex-gui.png)

- **Work with projects**: select a local folder, view or switch Git branches, and organize conversations by project.
- **Add context**: type a message, paste images, reference files or folders, or type `/` to choose a command or skill.
- **Choose how to work**: adjust the model, reasoning effort, and access permissions for each task.
- **Follow progress**: see replies, plans, command output, and file diffs as they arrive; answer approvals or stop a task.
- **Pick up where you left off**: search, rename, pin, or archive conversations, then reopen them to continue.
- **Use desktop or browser**: access the same workspace through Switch's hosted web UI; tasks run on the Switch host.

On first use, follow the page's prompt to download Codex. See the [Codex GUI guide](docs/codex-gui.md) for more details.

### Account management and local proxy

![Remote AI account dashboard](docs/assets/codex-switch-dashboard.png)

### Conversation management

![Remote AI conversation management](docs/assets/codex-switch-conversations.png)

### Third-party providers

![Remote AI providers](docs/assets/codex-switch-providers.png)

### Token analytics

![Remote AI token analytics](docs/assets/codex-switch-token-usage.png)

### One-click themes

Includes 300+ presets and integrates with [Fei-Away/Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin).

![Remote AI one-click themes](docs/assets/codex-switch-dream-skin.png)

### Plugin Market

![Remote AI Plugin Market](docs/assets/codex-switch-skills.png)

### 2FA authenticator

Select **2FA** in the menu to view and manage authentication codes in the main window's content area.

![Remote AI 2FA authenticator](docs/assets/codex-switch-two-factor.png)

### Floating usage widgets

<p align="center">
  <img src="docs/assets/codex-switch-floating-usage.png" alt="Remote AI compact floating usage widget" width="146">
  &nbsp;&nbsp;&nbsp;
  <img src="docs/assets/codex-switch-floating-usage-expanded.png" alt="Remote AI glass floating usage panel" width="345">
</p>

## Features

- Reuses the Codex CLI OAuth 2.0 + PKCE login flow, with both in-app and system-browser login.
- Imports and manages multiple `auth.json` files, including common third-party JSON exports and multi-account files.
- Atomically switches `$CODEX_HOME/auth.json` (default: `~/.codex/auth.json`) and supports `.cs` account/provider backups.
- Displays plan and expiration details, primary/secondary usage windows, reset credits, daily tokens, and configurable account-table columns.
- Supports manual or scheduled account refreshes, top-menu navigation and search, system-tray switching, and a best-effort **Restart ChatGPT** action.
- Offers compact and glass-style always-on-top usage widgets with quota, reset, and status details.
- Supports OpenAI Responses and Chat Completions-compatible Providers, multiple models, model-control policies, and balance queries for common relay platforms.
- Routes third-party Providers through the loopback proxy on `127.0.0.1:15722` and supports hot switching between official accounts and Providers.
- Records proxy token usage, displays conversation/message details, context consumption and latency, and exports structured diagnostics.
- Provides weekly heatmaps and trends plus token-type, Provider, model, and account rankings.
- Retries upstream HTTP 429 responses after progressively longer waits for up to five minutes by default,
  returning only the last 429 when the time limit is reached.
- Can refresh accounts after quota exhaustion, select an eligible account with the lowest primary-window
  usage, and switch credentials.
- Can serve a browser UI alongside the desktop app, optionally expose it to trusted LAN devices, or run it
  without desktop UI through `--headless --port`.
- Includes a Skills Market for searching and installing community Skills; cloud-signed-in users can publish versioned packages and updates.
- Includes 300+ Dream Skin presets with one-click apply, custom backgrounds, appearance controls, and restore support.
- Groups preferences by appearance, window behavior, usage, network, privacy, and storage, including language,
  accent color, close-to-tray behavior, usage widgets, account refresh, and token analytics.
- Optionally syncs with a self-hosted Go backend. The Expo mobile app can refresh official usage/reset credits, while both the mobile and standalone Web apps can remotely switch a selected PC between official models and synchronized Providers. Cross-source switches prompt for a ChatGPT/Codex restart.
- Keeps account credentials and Provider secrets in the Rust backend, out of the React UI and application logs.

> [!IMPORTANT]
> Account credentials, Provider API keys, and cloud-login tokens are stored in the application data directory without additional at-rest encryption. A `.cs` backup contains restorable credentials and keys. Cloud sync is opt-in, but enabling it uploads those secrets to the server you configure. Use only trusted devices and self-hosted servers; never commit, share, or publish credential files, backups, or unchecked diagnostics.

## Getting started

### Linux packages

Download the Linux x64 `.deb` from [Releases](https://github.com/piperhex/remoteai/releases).
Replace the filename below with the downloaded package name:

```bash
sudo apt update
sudo apt install "./codex-switch.deb"
csw
```

On an Ubuntu server without a desktop, provide a virtual display:

```bash
sudo apt install xvfb xauth dbus-x11 xdg-utils
xvfb-run -a dbus-run-session -- csw --headless --port=18080
```

The web UI listens on `127.0.0.1:18080` by default. Package users do not need Node.js or Rust.
See the [Linux installation and usage guide (Chinese)](docs/linux.md) for systemd, startup at boot,
SSH access, LAN listening, proxy keys, backups, and troubleshooting.

### Prerequisites

These prerequisites are for developing and building from source.

- Node.js 18 or later
- npm
- Latest stable Rust toolchain
- [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your platform
- WebView2 on Windows and Xcode Command Line Tools on macOS

On Ubuntu, install the Tauri Linux build dependencies:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libappindicator3-dev librsvg2-dev patchelf xdg-utils
```

Install dependencies and start the desktop app:

```powershell
npm install
npm run dev:app
```

Other common commands:

```powershell
npm run dev
npm run dev:admin
npm run dev:backend
npm run start -w @codex-switch/native
npm run build:app
npm run check
```

The development browser preview uses demo data and never accesses real credentials. The mobile companion requires a deployed cloud backend; it receives redacted summaries plus a short-lived Codex access token for direct usage/reset-credit refreshes. The mobile and standalone Web apps can remotely switch a selected online PC between official models and synchronized Providers. Provider switching requires the local proxy to be running on the target PC, and cross-source switches prompt for a ChatGPT/Codex restart. See [the mobile README](apps/native/README.md) and [the admin backend README](apps/admin-go/README.md).

## Usage

1. Select **Add account** and sign in in the app, through the system browser, or import `auth.json` / a compatible JSON export.
2. Refresh account usage and expand a row to view reset credits.
3. Select **Switch** to atomically replace the `auth.json` currently used by Codex.
4. If a running ChatGPT/Codex process may have cached the old credentials, use **Restart ChatGPT** from the dashboard or tray.

An installed client can start the browser UI alongside the desktop interface, or run it without creating a
window, tray icon, or floating widget. It listens only on `127.0.0.1` by default; enable **Listen on LAN** in
Settings to allow access from trusted devices on the same network. In headless mode the command-line port
applies only to that process:

```powershell
csw.exe --headless --port=18080
# Also supported: csw.exe --headless --port 18080
```

Open `http://127.0.0.1:18080` after startup. `--headless` requires `--port`, whose valid range is `1-65535`.

Linux uses `csw`; servers without a desktop require the virtual-display command above.
When LAN access is enabled, the web access key grants full management permissions.
Model clients use a separate proxy API key.

The **Providers** page manages OpenAI Responses or Chat Completions-compatible endpoints, API keys, models, and model-control policy. Third-party Providers can be used only while the local proxy is running. The proxy listens on `127.0.0.1:15722`, directs Codex to it, and enables hot switching.

To share the model proxy, start it, open **Proxy settings**, click **Add key**, enter a name, and save.
Leaving the key blank generates one automatically. **Listen on LAN** stays disabled until at least one
enabled key has been saved. Then enable listening and copy the proxy API key from its row; it is separate
from the web access key. In the browser, copying writes to the clipboard on the computer viewing the page.

The **Skills** page can browse, search, and install community Skills locally. Publishing or updating a versioned Skill package requires a signed-in cloud account. The **One-click themes** page provides 300+ bundled Dream Skin presets plus custom-background and restore controls.

Settings lets you add, edit, enable, and disable multiple Codex Home entries. Account and Provider changes are
applied to every enabled directory. Removing all entries resolves `CODEX_HOME` first and then `~/.codex`.
Administrators can also publish
separate Windows and macOS path suggestions; the client shows only the path for its current system. This setting
does not modify system environment variables. Managed account copies, Provider settings, application settings,
cloud tokens, proxy logs, and token-usage history remain in the operating system's application data directory.

The custom cloud server setting is hidden by default. Self-hosted users can set
`showCustomCloudServer` to `true` in `settings.json` to display it on the Settings page.

## More documentation

- [Linux installation and usage (Chinese)](docs/linux.md)
- [Architecture and data flow](docs/architecture.md)
- [Development and debugging](docs/development.md)
- [Contributing guide](CONTRIBUTING.md)

## License

Remote AI is licensed under the [Apache License 2.0](LICENSE), the same license used by the official [OpenAI Codex](https://github.com/openai/codex) repository.

## Disclaimer

Remote AI is independently developed third-party software and is not affiliated with, associated with, authorized by, endorsed by, or officially partnered with OpenAI or its Codex products.

## Star History

<a href="https://www.star-history.com/#piperhex/remoteai&Date">
  <picture>
    <source
      media="(prefers-color-scheme: dark)"
      srcset="assets/star-history/star-history-dark.svg"
    />
    <source
      media="(prefers-color-scheme: light)"
      srcset="assets/star-history/star-history-light.svg"
    />
    <img
      alt="Remote AI Star History"
      src="assets/star-history/star-history-light.svg"
    />
  </picture>
</a>
