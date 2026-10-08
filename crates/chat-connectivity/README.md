# Chat connectivity

Session-scoped EasyTier integration for desktop, the Windows unattended service, Android and iOS.
Uses separate userspace TCP streams for chat and file downloads, and a loopback WebRTC adapter over userspace UDP
for desktop media;
never creates a TUN device, changes host routes, or exposes arbitrary
application ports. Browsers continue to use WebRTC and the existing encrypted WebSocket fallback.

The native engine is pinned to EasyTier commit `ed73d318bb3bf19601e227ab83dd61d66ce4b9f8`.
`Cargo.lock` pins transitive dependencies. Desktop has a separate lockfile which must be updated with this crate.
See [upstream source](https://github.com/EasyTier/EasyTier/tree/ed73d318bb3bf19601e227ab83dd61d66ce4b9f8).
The `easytier-core` package is vendored with a bounded mixed symmetric NAT fallback; see
[patch notes](vendor/easytier-core/CODEX_SWITCH_PATCH.md). Both Cargo roots select the same patched package.

## Build

Install Rust 1.96.1 or newer and Protobuf (`protoc`). On Windows, put 7-Zip on PATH as well; upstream's Windows
compatibility-library build uses it. Linux requires a C compiler and CMake. Run:

```sh
cargo fmt --manifest-path crates/chat-connectivity/Cargo.toml --all --check
cargo test --locked --manifest-path crates/chat-connectivity/Cargo.toml -p easytier-core \
  --no-default-features --features aes-gcm,proxy-smoltcp-stack,tcp-hole-punch connectivity::hole_punch --lib
cargo test --locked --manifest-path crates/chat-connectivity/Cargo.toml
cargo clippy --locked --manifest-path crates/chat-connectivity/Cargo.toml --all-targets -- -D warnings
```

Android additionally needs the React Native NDK and `cargo install cargo-ndk --version 4.1.2 --locked`.
Expo's chat connectivity plugin registers the JNI module and a Gradle task which builds every requested ABI.
The APK verifier checks `libcsw_chat_connectivity.so` in all four release ABIs. iOS builds a static XCFramework for
device arm64 and both simulator architectures during installation of the local CocoaPod. iOS requires macOS/Xcode.

## Session boundaries

- Both endpoints must advertise native connectivity before admin-go provides the configuration.
- Each session has a distinct network name and HMAC-derived secret. Signaling reconnects preserve these credentials.
- Desktop commands obtain endpoints and credentials from the authenticated Rust signaling worker; JavaScript supplies
  only a session ID. The installed service child is trusted native code with a fixed parent RPC allowlist.
- Native expiry enforcement also works while JavaScript is suspended. Authenticated renewal extends the same engine.
- Native readiness requires a direct, one-hop route and its selected direct connection. The configured rendezvous
  node disables application-data relaying. Existing WebSocket fallback retains its own relay accounting.
  Both punched and non-punched sockets qualify once the selected, open connection has a measured round trip.
  EasyTier's `directly_connected_conns` excludes punched sockets and must not be used as a P2P allowlist.
  Transport admission alone does not open the chat stream; diagnostics use the same verified connection check.
- Closing the owner cancels discovery, sockets and mapping leases. Native queues and frame sizes are bounded.
- A full frontend send queue is retryable backpressure, not proof of a lost direct route. Pending chat fragments
  retain their acknowledgements and retry without clearing healthy probes; native write failures and heartbeat
  timeouts still activate the relay. Desktop and mobile share this distinction in `shared/remote-chat`.
- Binary file support is opt-in on both native endpoints. A version handshake on the dedicated file stream
  must complete before it is advertised as available; older native clients retain their existing fallback.
  Desktop submits up to 16 encrypted RAB1 records through raw Tauri IPC, sharing the existing 4 MiB IPC budget.
  Each record is at most 16 KiB. Each native session allows one write in progress, one queued batch and
  16 received records, with at most eight sessions. Android workers deliver JNI byte arrays directly to the
  bounded download router; file bytes never cross the JSON poller or React Native bridge.
  The file stream uses the same direct-route and grant checks as chat. Reconnection replaces its generation,
  drops queued writes, and fences transfer epochs through the existing download control protocol.
- Desktop media adapters reuse the same engine and authorization. They bind only loopback with ephemeral TURN
  credentials and allow datagrams only to/from the counterpart's virtual IP while its route is direct. Per-view
  close and grant revocation stop allocations; no raw media crosses the JSON ABI. A peer-specific UDP receive
  registration allows ICE's initial inbound packet without first sending to that port.
  Both UDP and TCP loopback endpoints are available: Chromium on Windows binds UDP to enumerated physical
  interfaces that cannot reach `127.0.0.1`, while TCP selects loopback correctly. TCP framing terminates on the
  same device; the remote media still uses the verified native datagram route. Local TCP clients are bounded,
  expire when idle, and stop when the view or grant closes; authentication and peer restrictions are unchanged.

## Desktop media regression

The default Rust tests exchange real WebRTC control and H.264 RTP through two native adapters with relay-only ICE
and no public relay. They also cover allocation limits, ownership, cancellation and passive UDP reception.
With npm dependencies and Microsoft Edge installed, run the additional browser interoperability test:

```sh
cargo test --manifest-path crates/chat-connectivity/Cargo.toml browser_media -- --ignored --nocapture
```

It verifies decoded video, received audio and control messages with Chromium WebRTC, both with the default route
and after media permission exposes physical/virtual interfaces. Only native adapter candidates are exchanged so
a same-machine host candidate cannot conceal an adapter failure. It also exercises BUNDLE allocation pruning.
It does not measure real carrier NAT success rates.

## Android binary downloads regression

The default Rust tests exchange file records through real native engines, keep chat responsive during receiver
backpressure, and reject writes from a replaced stream generation. The Android regression additionally checks
4 MiB of byte-exact Rust/JNI delivery into the native download router, ownership and cleanup. It uses an isolated
test application and a loopback fixture; it never contacts the production coordinator.

After Android prebuild, build `:app:assembleDebug :app:assembleDebugAndroidTest` with
`-I ../e2e/native-bulk.init.gradle -PreactNativeArchitectures=x86_64` (choose the device ABI), install both test APKs,
and forward the fixture with `adb reverse tcp:18779 tcp:18779`. Start
`cargo test --manifest-path crates/chat-connectivity/Cargo.toml android_binary_bridge_fixture -- --ignored --nocapture`,
then run `com.codexswitch.connectivity.NativeBulkDeviceTest` using
`com.codexswitch.mobile.downloadtest.test/com.codexswitch.downloads.DownloadTestRunner`.
Run `DownloadEngineTest` and `BulkDownloadTest` with the same runner for pause/resume, AEAD, hashes and checkpoints.
Remove the adb reverse rule after the test. This loopback regression does not predict mobile-network throughput.

## Dependency notices

Our adapter is Apache-2.0. EasyTier is LGPL-3.0; its license is included in `LICENSE-EasyTier` and the exact source is
linked above. The modified core, its LGPL license, and patch notes are in `vendor/easytier-core`;
the host integration and protocol definitions retain the pinned upstream dependency.
The repository, lockfiles and build scripts provide the corresponding source/build inputs for relinking.
Include this notice and the dependency license with distributed native binaries.
