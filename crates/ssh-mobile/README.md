# Mobile SSH bridge

Android and iOS use this library to connect directly to SSH servers through `csw-ssh-client`.
No desktop device, chat session, cloud relay or local shell is required. Saved connection settings and
credentials continue to use the account's existing SSH profile API.

The React Native `DirectSsh` module runs blocking bridge calls on platform workers. A native bridge owner
and a separate account scope partition sessions. Navigation preserves sessions; sign-out disposes them.
Platform invalidation drains queued calls and releases all owned sessions. Each scope permits eight
sessions, including in-flight opens, with bounded replay buffers and binary-transfer flow control.
Host fingerprints are checked by the shared SSH client before authentication. X11 is desktop-only.

Build Android through `apps/native/plugins/withDirectSsh.cjs` and `scripts/build-direct-ssh.cjs`.
The iOS pod builds a device/simulator XCFramework on macOS. Expo Go cannot load this native module.

Run `cargo test --manifest-path crates/ssh-mobile/Cargo.toml` and Clippy for protocol and buffer tests.
For physical Android acceptance, `apps/native/e2e/direct-ssh.init.gradle` builds an isolated test app.
The fixture uses a disposable SSH/SFTP server and `direct-ssh-control.mjs` solely for test credentials
and result reporting; all SSH traffic and cryptography run in the phone's native library. Forward test
ports 15995 and 22028 with adb, set `SSH_TEST_CONFIG` for the control server, then run the isolated app.
`direct-ssh-checks.ts` verifies authentication, host-key rejection, PTY I/O, resize, SFTP and cleanup.

The mobile web entry retains computer-assisted SSH because ordinary web pages cannot open arbitrary
TCP connections. Its selector and explanatory copy identify that route explicitly.
