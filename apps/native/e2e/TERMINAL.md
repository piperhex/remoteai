# Terminal keyboard regression

Run on an Android API 35 emulator with a software keyboard. The fixture uses
`com.codexswitch.mobile.terminaltest`, a local shell simulation, and a separate
`terminal-fixture.apk`; it does not connect to a computer or replace the normal app.

From the repository root in PowerShell (Android SDK and Java must be configured):

```powershell
$env:NODE_ENV = 'production'
$env:NODE_PATH = (Resolve-Path apps/native/node_modules).Path
$env:ANDROID_SERIAL = 'emulator-5580'
Push-Location apps/native/android
.\gradlew.bat assembleRelease -I ../e2e/terminal.init.gradle -PreactNativeArchitectures=x86_64
Pop-Location
node apps/native/e2e/terminal-keyboard.mjs
```

The script verifies that the header controls, session tab, WebView and shortcuts
stay on screen in portrait, with wrapping disabled, in landscape, and after
hiding/reopening the terminal. It checks the layout before, during and after
keyboard use, that height is restored when the keyboard closes, and that hiding
keeps the session alive. Screenshots go to
`.codex-tmp/terminal-keyboard-regression/`. Inspect the current command and cursor
in those screenshots. `--installed` tests the fixture already on the emulator.

The original `navigationBarTranslucent` modal fails the first keyboard check:
its WebView and shortcuts extend below the keyboard's top edge.

The old landscape drawer combined a full percentage height with a flex layout
aligned to the bottom. The keyboard check must also assert header visibility:
shortcuts can remain above the keyboard while the header is pushed off screen.
Landscape puts session tabs, controls and shortcuts in one toolbar to leave room
for command rows above tall keyboards. The regression also requires
enough output height for two complete rows, including padding and the scrollbar.

The bundled terminal's command visibility, row fitting, wrapping and touch
scrolling are also covered by `apps/web/e2e/chat-terminal-display.pw.ts`:

```powershell
npm run test:chat:e2e -w @codex-switch/web -- chat-terminal-display.pw.ts --project=mobile
```

iOS keyboard avoidance uses `KeyboardAvoidingView` and still needs device testing
on a Mac; the Android regression does not validate iOS layout.

## SSH and files

The terminal fixture also simulates account SSH profiles and an SFTP directory.
Build the same fixture with `-PreactNativeArchitectures=arm64-v8a` for a physical phone,
install `terminal-fixture.apk`, then run:

```powershell
$env:ANDROID_SERIAL = '<device serial>'
node apps/native/e2e/ssh-test.mjs
```

Run this alone on the device. It checks pulling saved connections, adding a connection,
host confirmation, the shared expandable file tree, long-press rename/deletion, tabbed text/code
editing, save-and-reopen round trips, retained drafts after closing the browser, and returning to the terminal at
font scales 1.0 and 1.3, including landscape. Set `SSH_FILES_ONLY=1` to run the focused file checks.
The fixture retains uploaded bytes so reopening a saved file verifies its content. It also checks each tab's
close button and the overflow menu for hidden tabs. It restores the original
font and rotation settings. Inspect `.codex-tmp/mobile-ssh-android/` screenshots for glyph
clipping. Native transfer unit tests cover picker uploads and download publication;
desktop `ssh.pw.ts` covers actual SSH/SFTP in local, remote, Web PC and phone layouts
using the disposable WSL server. iOS presentation still requires device validation.

Run `npm run test:chat:e2e -w @codex-switch/desktop -- ssh-project-browser-mobile.pw.ts`
for the mobile Web entry point, including touch menus, search, save, draft restoration and landscape.
`project-browser-native.pw.ts` checks the bundled offline editor and the regular native browser bridge.

For SSH cloud sync, start the real Go profile API against a disposable PostgreSQL database:

```powershell
$env:SSH_PROFILES_TEST_DSN = 'host=127.0.0.1 port=15432 user=parity password=local-parity-only dbname=ssh_profiles_test sslmode=disable'
go -C apps/admin run ./testsupport/ssh-profiles
```

In another terminal set `EXPO_PUBLIC_SSH_CLOUD_FIXTURE=1` before building the native fixture, then run
`adb -s <device> reverse tcp:1499 tcp:1499` and set `SSH_CLOUD_FIXTURE=1` before running `ssh-test.mjs`.
The script resets only fixture-owned profiles and verifies native saves in PostgreSQL at font scales 1.0 and 1.3.
With the same Go fixture, set `SSH_CLOUD_FIXTURE=1` and run
`npm run test:chat:e2e -w @codex-switch/desktop -- ssh-cloud.pw.ts`
to verify desktop local/remote and Web wide/narrow layouts, migration, conflicts and deletion.
The live WSL `ssh.pw.ts` regression also uses this profile fixture while terminal and SFTP traffic use port 1498.
