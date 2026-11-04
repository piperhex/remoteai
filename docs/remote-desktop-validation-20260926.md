# Remote desktop 1.6.2 implementation validation

Validated on 2026-09-26. The Android phone and Windows 11 guest run locally built 1.6.2
packages with the new native sender. These are installed test builds, not a newly published release.
The implementation is in `5de03687`; container address mapping and deployment-shaped tests are in `ab868445`.

## Results

| Sender and receiver | Route and output | Observed rate |
| --- | --- | --- |
| Physical Windows / RTX 5080 to Edge | LAN, 1920 × 1080, 60 FPS target | 59.8 decoded FPS |
| Same physical host to Edge | LAN, 1920 × 1080, 120 FPS target | 119.8 decoded FPS, 599 frames in 5 seconds |
| Win11 Hyper-V guest to Xiaomi Civi 1S / Android 14 | LAN, 1708 × 960, 60 FPS target | About 30–32 rendered FPS, 0 renderer drops in sampled intervals |
| Same guest and physical phone | Public TURN, 1708 × 960 | About 30–32 rendered FPS, 0 renderer drops in sampled intervals |

The physical host's display runs at approximately 143 Hz. Its numbers are five-second browser decoder
samples, not phone measurements or a long-duration performance guarantee. The guest uses the Microsoft
Remote Display Adapter, which reports 32 Hz. Windows Graphics Capture cannot create the required D3D11
device in this guest; the tested fallback is native GDI capture plus OpenH264. This guest has not reached
60 or 120 FPS. Faster LAN bandwidth does not remove its display/capture limitation.

Phone measurements used a continuously moving test pattern. The video overlay reported the selected
media route; Android libwebrtc `EglRenderer` logs supplied rendered FPS and dropped-frame counts.
The public relay test temporarily blocked the guest application's non-TURN UDP traffic in both directions.
The overlay changed to “中继”, and closing/reopening the viewer connected through relay again.
The phone stayed on Wi-Fi with mobile data disabled throughout.

Mouse movement was confirmed by guest cursor coordinates. The phone sent `relay162` into a dedicated
test textbox, whose value was read back as `remote162relay162`. Landscape rotation, close and reconnect
passed. The temporary firewall rules and motion-test processes were removed, the phone returned to
portrait, the encoder stopped when the viewer closed, and the installed desktop application stayed running.

## Public relay and accounting

- Authenticated control/chat WebSockets delivered desktop TURN credentials and exchanged signaling.
- External UDP STUN on the metered listener, TCP reachability and hostname-verified TLS passed.
- Browser sender/viewer tests forced relay separately over UDP, TCP and TLS. Each passed real video
  decoding, mouse/keyboard controls, display settings and capture shutdown.
- The native Windows sender also passed each public transport with `relay` as the selected candidate
  type. Five-second decoder samples were approximately 59.8, 55.2 and 59.8 FPS respectively. Browser
  fixture tests ran concurrently, so these are functional samples rather than transport benchmarks.
- Public TLS tests used normal certificate verification. Only the isolated local test accepts its
  generated certificate, through an explicit test setting.
- A dedicated temporary account accumulated 12,115,326 metered bytes. After its quota was set to zero,
  valid TURN allocations still succeeded but the media path could not connect. Accounted bytes stayed
  exactly unchanged. No real account quota was modified.

Two deployment problems were found and corrected: missing cloud firewall ports, and a wildcard relay
address that prevented two allocations on the same NATed server from communicating. The entrypoint now
uses the container's concrete IPv4 and coturn's public/private mapping. Other private destinations remain
blocked. The integration test uses the actual entrypoint, container restrictions and an unroutable
documentation address to cover this case without depending on cloud NAT reflection.

The Go service and coturn are deployed. The final mapping update recreated only coturn; the Go,
PostgreSQL and Redis container identities/start times remained unchanged. Local/public admin HTTP
checks passed, and the public unauthenticated API returned 401. No database migration was needed.

## Automated verification

- Rust: 1,344 tests passed, 9 opt-in tests ignored; formatting and strict Clippy passed.
- The ignored native decoder test was explicitly run for LAN 60/120 FPS and local/public TURN paths.
- Go tests, vet, formatting, Linux container race checks and 146-route backend parity passed.
- The updated deployment-shaped coturn integration passed UDP/TCP/TLS for both browser and native
  senders, with metered byte counts and active-allocation refresh across credential expiry.
- Relevant desktop Vitest coverage passed, including cancellation, cleanup, single-flight polling,
  credential refresh and host ownership. Native TypeScript, release APK, desktop TypeScript/Vite and
  Tauri release builds passed. Web desktop/portrait/landscape remote-desktop tests passed.
- The final code commit passed the repository commit checks, including workspace builds and Rust tests.

The preceding baseline and upstream design references are in
[the investigation](remote-desktop-investigation-20260926.md). Deployment requirements are in
[DESKTOP-RELAY.md](../apps/admin/DESKTOP-RELAY.md).
