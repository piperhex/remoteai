# Windows plugin processes

The Windows Codex GUI creates a private, per-engine plugin host. Its three built-in MCP entries
forward `REMOTEAI_PLUGIN_HOST` through Codex's `env_vars` allowlist. A short-lived helper asks the
host to launch the matching plugin and then exits. The host duplicates the helper's existing STDIO
handles, so Codex continues using its original MCP connection without an HTTP or message proxy.

The long-lived `csw.exe` plugin workers are direct children of the application. Windows Task Manager
controls the final visual grouping; changing an AppUserModelID alone is not a reliable grouping fix.
The separate unattended Windows service and Chrome Native Messaging host keep their own lifetimes.

The pipe rejects remote connections. Both peers verify the executable, Windows logon session and
integrity level. The host accepts only its Home's exact three helper arguments and duplicates STDIO
handles from the connected process, not an arbitrary supplied PID. A worker is created suspended,
added to a job that terminates on handle closure, and only then resumed. The explicit handle list
prevents it from inheriting the application's other handles. GUI disconnect and application exit
release all owned plugin jobs. A lost acknowledgement never triggers a second launch.

Other Homes and external CLI installations still run their helpers directly. They do not require a
running GUI. macOS and Linux keep their existing launch paths. Desktop remote mode and Web use the
same host-side GUI engine, so the Windows ownership rule applies there without frontend changes.

## Verification

Run the Rust `windows_plugin_host` tests and the three plugins' installation tests. The integration
script requires a debug application build, an installed Codex CLI, an installed CUA package directory
and an artifact directory, all supplied as absolute paths:

```powershell
node apps/desktop/scripts/test-plugin-host.mjs <debug-csw.exe> <codex.exe> <CUA-package-directory> <artifacts>
```

The script creates isolated plugin records and a private Codex Home. It checks standalone CLI
compatibility, discovers all three real plugins through Codex, calls their tools without a model
turn, verifies direct process ownership, then terminates the fixture host and checks for surviving
workers and descendants. The remote-command fixture deliberately has no cloud bridge, so its call
must return the ordinary disconnected error. The script never changes the user's plugin grants.

Set `CSW_PLUGIN_HOST_HOLD=1` to retain the successful fixture for up to ten minutes while inspecting
Task Manager. Create the reported fixture directory's `finish` file to continue cleanup immediately.
`verify-process-grouping.ps1` captures Task Manager's current UI tree and screenshot. Its administrator
execution requires Windows user consent; it does not grant administrator access to Computer Use.
