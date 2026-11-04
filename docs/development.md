# Development and Debugging

The admin backend and UI are optional, independent submodules. Initialize them with
`git submodule update --init apps/admin apps/admin-ui` and install UI dependencies with
`npm ci --prefix apps/admin-ui` before using admin commands. See [admin repositories](admin-submodules.md).

Native is also an optional, independent submodule. Run `git submodule update --init apps/native` and
`npm --prefix apps/native ci` before mobile commands. It owns its dependencies and release tags; see
[the Native repository guide](native-submodule.md).

Web is independently installed with `npm ci --prefix apps/web`, and its standalone commands run through
`npm run dev:web`, `npm run build:web` and `npm run check:web`. Shared components live in `shared`;
initialize Web for Web development and cross-application tests, including desktop `test:typecheck`.
See [the Web repository guide](web-submodule.md).

For installed Linux packages, headless servers, systemd, and proxy setup, see
[Linux installation and usage (Chinese)](linux.md). The dependencies below are for building from source.

## Environment Setup

Install Node.js, npm, the Go toolchain declared in `apps/admin/go.mod`, the latest stable Rust toolchain, and the Tauri 2 dependencies for your platform. Then install project dependencies:

```powershell
git submodule update --init shared packages/i18n
npm install
```

Windows desktop builds require Visual Studio 2022 C++ build tools, Windows SDK 10.0.26100.0,
and CMake 3.20 or newer. In Visual Studio Installer, include **C++ CMake tools for Windows**.
The desktop build scripts use CMake and CTest from PATH when available, then look for Visual Studio's
bundled tools (including custom installation locations) and the standard `C:\Program Files\CMake\bin`
installation. A separate CMake installation in another location must have its `bin` directory on PATH;
reopen the terminal after changing PATH.
Windows release builds also need [7-Zip](https://www.7-zip.org/download.html) on PATH to unpack native
dependencies. After installing it, add `C:\Program Files\7-Zip` to PATH and reopen the terminal.

Ubuntu needs the Linux WebKitGTK/AppIndicator and screen capture dependencies before
`npm run dev:app`, `npm run check`, or `npm run build:app`:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev \
  libappindicator3-dev librsvg2-dev patchelf xdg-utils pkg-config libclang-dev libxcb1-dev \
  libxrandr-dev libdbus-1-dev libpipewire-0.3-dev libwayland-dev libegl-dev
```

The screen capture bindings require newer PipeWire headers than Ubuntu 22.04's 0.3.48 package.
Ubuntu 24.04 provides a suitable development package. The release workflow keeps Ubuntu 22.04 as its
build baseline by compiling a checksum-pinned PipeWire 1.0.5 SDK into a private directory and setting
`PKG_CONFIG_PATH` for compilation; it does not replace the system PipeWire runtime. See the
`Prepare Linux screen capture SDK` step in [release.yml](../.github/workflows/release.yml).

Dependency versions are locked by the root `package-lock.json` and `apps/desktop/src-tauri/Cargo.lock`. Include both lockfile changes whenever a dependency update is intentional.

## Common Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the desktop browser preview with data from `apps/desktop/src/demo.ts` |
| `npm run dev:app` | Start the complete Tauri desktop application |
| `npm run dev:admin` | Start the admin console |
| `npm run dev:backend` | Start the Go backend (configuration in `apps/admin/.env`) |
| `npm --prefix apps/native run start` | Start the Expo mobile development server |
| `npm --prefix apps/native run android` | Start Expo and open the Android target |
| `npm --prefix apps/native run ios` | Start Expo and open the iOS target |
| `npm run build` | Build the parent npm workspaces |
| `npm run build:desktop` | Type-check and build the desktop frontend |
| `npm run build:admin` | Build the admin console |
| `npm run build:backend` | Build the Go backend into `apps/admin/dist/` |
| `npm run build:app` | Build desktop installers |
| `npm run build:app:mac` | Build a universal macOS bundle |
| `npm run build:app:win-arm64` | Build a Windows ARM64 bundle |
| `npm run check:rust` | Check Rust formatting and run Rust tests |
| `npm run check` | Check parent frontend workspaces and desktop Rust |
| `npm run test` | Run workspace test scripts where present |
| `npm run nx -- graph` | Open the Nx project graph |
| `npm run release` | Bump the patch version, tag, and push a stable release |
| `npm run release-beta` | Bump or create a beta prerelease tag |

## Browser Preview and Desktop Mode

The browser preview does not read real files, start OAuth, access real accounts, or open native windows. `apps/desktop/src/api/backend.ts` selects the appropriate implementation by detecting the Tauri runtime. When adding a backend operation, also define its preview behavior: provide demo/localStorage state or clearly report that the operation is unavailable.

Use a custom Codex directory in desktop mode to avoid changing your everyday environment:

```powershell
$env:CODEX_HOME = "$PWD\.local-codex"
npm run dev:app
```

The `.local-codex/` directory may contain credentials. Confirm that it cannot be committed before using it. A temporary directory outside the workspace is safer.

For local Windows ARM64 app builds, install the Rust `aarch64-pc-windows-msvc` target and use a Visual Studio/MSVC developer environment with ARM64 build tools before running `npm run build:app:win-arm64`.

## Debugging Guidelines

### Desktop Frontend DevTools

Development and release builds support the WebView inspector. It stays closed at startup.
Focus the application window, then press **Ctrl+Shift+I** on Windows/Linux or **Command+Option+I**
on macOS. Close the inspector window when finished. The same shortcut works in desktop local and
remote modes; Web uses the browser's own developer tools.

The desktop's `tauri` dependency enables the `devtools` feature without changing Release optimization.
Use Tauri's built-in shortcut and existing `core:default` capability; no application startup code should
call `open_devtools()`. Keep the inspector closed for baseline CPU/memory measurements, and record
performance traces only while reproducing a problem because the inspector and recording add overhead.

### Troubleshooting

- UI or state issue: reproduce it first with `npm run dev` and demo data.
- IPC issue: verify that command names and arguments in `apps/desktop/src/api/backend.ts` match `commands.rs`.
- File issue: set a temporary `CODEX_HOME` instead of modifying an account you regularly use.
- OAuth issue: confirm that local ports `1455` and `1457` are free, then try the system-browser flow.
- Tray issue: confirm `system_tray::refresh_menu` is called after account, usage, or active-account changes.
- Floating bubble issue: inspect `settings.json`, window label `usage-bubble`, and the `theme-color-changed` event path.
- Provider/config issue: inspect the managed blocks in `$CODEX_HOME/config.toml`, `config-before-provider.toml`, the selected Provider JSON, and the `providers-changed` event path. Never paste real Provider keys into an issue.
- Local proxy issue: confirm `127.0.0.1:15722` is free, inspect `state.json`, call the local `/health` route, and export diagnostics from Settings. Review an export before sharing because upstream error details can still be sensitive.

  For interrupted model responses, see [stream diagnostics](proxy-stream-diagnostics.md) for error fields, request correlation, and capture limits.
- Token Usage issue: requests must pass through the local proxy. Inspect `token-usage.sqlite3`, the `token-usage` capability label, and the hash route used by the auxiliary window.
- Cloud issue: verify the configured Base URL, Kong route split, backend logs, and `lastModifiedAt` values. Use only fake credentials while debugging synchronization.
- Mobile issue: verify the same Base URL reaches `/auth/login` and `/sync/accounts/summary` from the device; localhost on the development computer is not localhost on a physical phone.
- Admin schema issue: when `POSTGRES_DB_SYNCHRONIZE=false`, apply only missing compatible migrations from `apps/admin/sql`; follow `apps/admin/DEPLOYMENT.md`.
- Restart issue: test with a disposable Codex session. Windows validates desktop process paths and creation times before using a process handle to stop an observed instance; macOS and Linux use their platform process and relaunch strategies. Recovery regression tests simulate CDP outages and process operations without restarting the installed desktop app.
- Rust logic: prefer unit tests around the pure parsing functions in `auth.rs` and `codex_api.rs`.

## Release Workflow

`npm run release` and `npm run release-beta` require a clean working tree. They update the root package and
lockfile, `apps/desktop/package.json`, and `apps/desktop/src-tauri/tauri.conf.json`. Desktop prerelease tags
receive a numeric WiX/MSI version such as `0.2.3-beta.0` -> `0.2.3.0`. The script commits the version bump,
creates an annotated tag, and pushes the current branch and tag to `origin`.

The GitHub Actions release workflow starts from `v*` tags or a manual run with an existing tag. It creates or
finds the GitHub Release, generates release notes when needed, and runs the relevant checks. It uploads Windows
x64 and ARM64, Ubuntu/Linux x64, and macOS Apple Silicon and Intel artifacts. Before publishing, the workflow
adds a download section grouped by platform, architecture, and package format, with a link to Native releases.

The Native repository's own `v*` tags publish its Android APK and unsigned iOS `.app.zip`. Its version command
updates the mobile version and Android `versionCode` independently. Android update checks use that repository;
producing an installable iOS IPA still requires signing credentials and a provisioning profile.

## Adding a Feature

1. Define the smallest redacted transfer model in `models.rs`.
2. Put external API, storage, or identity logic in the corresponding Rust module.
3. Orchestrate the use case in `commands.rs` and register the command in `lib.rs`.
4. Add a typed wrapper to `apps/desktop/src/api/backend.ts`.
5. If the feature is app-level configuration, update `AppSettings`, `storage.rs`, and the browser-preview behavior in `apps/desktop/src/api/backend.ts`.
6. If it affects Providers, hot routing, cloud sync, archives, or token history, update the dedicated Rust module and its persistence/version-compatibility tests instead of placing the behavior in `commands.rs`.
7. If it affects tray or floating-bubble behavior, update `system_tray.rs`, `floating_bubble.rs`, and the relevant event refresh paths.
8. For a new auxiliary Tauri window, use an async creation command on Windows, add its label to `src-tauri/capabilities/default.json`, and keep packaged routes compatible with the frontend route parser.
9. Manage business state in a hook, then render it through pages and components.
10. Implement backend changes in the `apps/admin` submodule and add required versioned SQL under `apps/admin/sql`.
    The NestJS source is removed. Follow [the admin repository guide](admin-submodules.md) and push child commits first.
11. Update the relevant architecture or usage documentation and run `npm run check`.

Pages must not call `invoke` directly. Tauri command functions must not absorb JWT parsing, HTTP response parsing, or low-level file-replacement logic.
