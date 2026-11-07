# SSH terminal and SFTP

This crate is used by desktop local terminals and by the authenticated PC host for
desktop remote and Web PC terminals. It supports password or pasted private-key
authentication, SHA256 host-key pinning, terminal input/resize, and SFTP browsing,
upload, download, file/folder creation, rename, and confirmed recursive deletion.

Optional X11 forwarding displays graphical applications on the PC that owns the
SSH connection, including when the terminal is viewed through remote mode or Web.
Saving a profile with X11 enabled prepares that PC's X server before saving. Testing
and connecting also prepare it. Windows bundles VcXsrv and starts it when needed;
macOS starts an installed XQuartz. Linux uses the login session's existing X server.
The SSH server must permit X11 forwarding. Existing displays are reused only after
a bounded X11 handshake; startup is serialized across local and remote callers.
The display defaults to the host's `DISPLAY` environment variable, then `:0`.
Explicit displays accept local Unix sockets (`:0`, `unix:0`) or loopback TCP
(`localhost:0`, `127.0.0.1:0`, `[::1]:0`), with an optional screen suffix.
On Windows, `:0` connects to TCP port 6000; Unix uses `/tmp/.X11-unix/X0`.
XQuartz launchd socket paths are accepted only from the host's environment.
The host reads `XAUTHORITY` or its home `.Xauthority`; only a random session cookie
is sent to the SSH server. Incoming channels must present that cookie before any
bytes reach the X server. Up to 32 X11 channels can run per SSH session, and closing
the terminal closes them. This is trusted X11 access, so enable it only for trusted
SSH servers and applications. Managed VcXsrv uses a separate per-user authority file
and keeps access control enabled. Its cookie and process paths never cross IPC or
cloud synchronization. See the desktop `resources/x-server/NOTICE.md` for packaging,
the pinned upstream release, corresponding source and platform support.

Connections are limited to eight. Uploads use 256 KiB chunks with progress and cancellation;
there is no total upload size cap. Temporary files belong to their SSH session and are removed
on cancellation or session close. Inactive uploads are also pruned on subsequent file requests.
Existing destinations require an explicit overwrite or numbered-name choice. SFTP v3 rename
protects numbered uploads from concurrent name collisions; overwrite retains the previous file
until the complete upload can be published and attempts rollback if publication fails.
The legacy whole-file download API remains limited to 5 MiB. Bounded range reads are also available.
Profiles retain only connection metadata and the accepted host fingerprint;
passwords, private keys and passphrases are never persisted. SSH agents, jump
hosts, general-purpose tunnels, recursive uploads and remote editing are outside this version.

Desktop local, remote and Web PC terminals accept file drops on the terminal or
the SFTP browser. A terminal drop targets its reported working directory; a browser
drop targets the displayed directory. The destination stays fixed for the complete
batch, even if the shell changes directory while files upload. Native desktop drops
use bounded local file reads; browser drops use the browser's selected file handles.

Directory synchronization installs prompt hooks for Bash, Zsh and Fish after normal
user startup configuration. The hooks report OSC 7 directory changes and OSC 133
prompt boundaries. Browsing to a directory queues a quoted `cd` until the terminal
has an empty prompt, leaving running commands and partially typed input intact.
Unknown shells retain their regular login startup; their directories can still
follow standard OSC 7 reports, but changing the shell directory also requires prompt
markers. Hook startup does not modify user configuration files. Zsh's temporary
startup proxies are removed after login; Bash uses an inherited descriptor and Fish
uses its init-command option.

## Automated checks

From the repository root, with Cargo on PATH:

```powershell
$env:CARGO_TARGET_DIR = "$PWD/.codex-tmp/ssh-target"
cargo test --locked --manifest-path crates/ssh-client/Cargo.toml
cargo clippy --locked --manifest-path crates/ssh-client/Cargo.toml --all-targets -- -D warnings
```

## Live WSL validation

The optional fixture creates random disposable credentials, a real Bash PTY and
an SFTP directory in a temporary WSL directory. It does not change users, sshd,
authorized keys or system configuration. Its shell runs as the WSL user, so run
it only for local tests and stop it afterward. SFTP is confined to the temporary
directory. Configuration is written under ignored `.codex-tmp`; never commit it.

Install `asyncssh==2.24.1` in a disposable WSL virtual environment, then run the
tracked server in WSL from the repository root (keep it running):

```sh
python3 -m venv /tmp/remoteai-ssh-fixture-env
/tmp/remoteai-ssh-fixture-env/bin/pip install asyncssh==2.24.1
/tmp/remoteai-ssh-fixture-env/bin/python apps/desktop/e2e/ssh-wsl-server.py
```

Alternatively set `SSH_FIXTURE_PYTHON` to an existing temporary dependency
directory. `--host`, `--bind`, `--port` and `--config` override networking and the
output path. The default listens on WSL port 22022 so the Windows client can
reach the WSL address.

In Windows PowerShell, from the repository root:

```powershell
$env:CARGO_TARGET_DIR = "$PWD/.codex-tmp/ssh-target"
$env:SSH_TEST_CONFIG = "$PWD/.codex-tmp/ssh-wsl/config.json"
cargo test --locked --manifest-path crates/ssh-client/Cargo.toml --test live -- --ignored
cargo build --locked --manifest-path crates/ssh-client/Cargo.toml --example bridge
$env:SSH_FIXTURE_CONFIG = $env:SSH_TEST_CONFIG
node apps/desktop/e2e/ssh-backend.mjs
```

Keep the bridge running, and in another Windows PowerShell terminal:

```powershell
$env:SSH_FIXTURE_CONFIG = "$PWD/.codex-tmp/ssh-wsl/config.json"
Set-Location apps/desktop
npx playwright test --config scripts/playwright.chat.config.ts ssh.pw.ts --workers 1
```

Playwright starts Vite if needed. It exercises the production local, remote and
Web PC components with real SSH/SFTP through the Rust bridge; Tauri IPC and the
device transport are replaced by a local test adapter. It does not validate the
packaged native window or a live relay connection. Screenshots are written to
`.codex-tmp/chat-playwright`. Stop the bridge before rebuilding it on Windows,
and stop the fixture with Ctrl+C to remove its temporary directory and credentials.

For directory synchronization and drops into the actual shell directory, start the
fixture with matching shell/SFTP paths (file operations remain restricted to its
temporary directory):

```sh
/tmp/remoteai-ssh-fixture-env/bin/python apps/desktop/e2e/ssh-wsl-server.py \
  --integration --port 22023 --config .codex-tmp/ssh-wsl/integration.json
```

Start the bridge with `SSH_FIXTURE_CONFIG` pointing to that JSON and
`SSH_FIXTURE_PORT=1508`. In a separate PowerShell terminal:

```powershell
$env:SSH_DIRECTORY_FIXTURE = '1'
Set-Location apps/desktop
npx playwright test --config scripts/playwright.chat.config.ts ssh-directory.pw.ts --workers 1
```

This covers local, remote and Web PC shell-to-browser navigation, queued
browser-to-shell navigation with partial input, and real SFTP content after drops.
