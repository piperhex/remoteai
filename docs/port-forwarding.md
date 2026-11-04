# Remote port mapping

In a remote computer's desktop chat workspace, **端口映射** appears immediately to the left of
**远程桌面**. Choose **TCP**, **UDP** or **全部（TCP + UDP）**, enter a **目标 IP**, remote port and local port,
then choose **添加并启动**. Existing mappings default to TCP. Editing a mapping can also change its protocol.
The IP is reached from the remote computer; leaving it blank uses `127.0.0.1` on that computer.
Both IPv4 and IPv6 literals are supported (IPv6 may be entered with or without brackets).
Leaving the local port blank
uses the remote port number. For example, remote port `3000` and local port `13000` make the remote
service available at `127.0.0.1:13000` on the viewing computer.
For a LAN service, target IP `192.168.1.20`, remote port `3000` and local port `13000` make
`192.168.1.20:3000`, as reached by the remote computer, available at the same local address.

Click a running mapping's local address to choose **在 Remote AI 中预览** or **在浏览器中打开**.
Both actions open `http://127.0.0.1:<local port>` through the existing mapping. The preview uses the
shared details drawer and retains the local address in its navigation history. Stopped mappings
cannot be opened. These actions are intended for HTTP services; copying remains available for other TCP clients.
UDP-only mappings show a copyable address without browser/preview actions.

Each computer supports up to eight saved mappings. Mappings can be started, stopped, edited, deleted and
copied independently. Phone and desktop automatically sync settings for the same signed-in account and
remote computer. A local cache keeps settings available offline. Editing a running mapping closes its old
listener before restarting with the new IP and ports; editing a stopped mapping leaves it stopped.
Switching chat threads or projects keeps active mappings running. On desktop, switching computers also keeps them running.
On mobile, switching computers stops the previous computer's mappings. Disconnecting or signing out
releases listeners and remote resources; saved mappings require a manual start after reconnection
or application restart. A local port already used by the same protocol cannot be reused. Separate TCP and UDP
mappings may share a port number. **全部** reserves both protocols and rolls back both if either fails to start.

This feature supports TCP and unicast UDP services at IP addresses reachable from the remote computer.
The viewer binds only `127.0.0.1`; it does not expose mapped ports to other devices. Custom DNS hostnames,
broadcast and multicast forwarding are outside the current scope. Enter an IP only, without a URL scheme or port;
unspecified addresses (`0.0.0.0` and `::`) are not connection targets. Older saved mappings keep
their original `127.0.0.1` destination.

## Phone app

Open **工具 → 端口映射**. Select TCP, UDP or both, then add a target IP, remote port and an optional local port.
The phone binds only its own
`127.0.0.1`; tapping a running address or its **打开** label shows **在 Remote AI 中预览** and
**在浏览器中打开**. Either option can be chosen directly from the mapping list. The in-app preview
uses an isolated WebView with back, refresh and browser controls. Stopping a mapping releases its listener and connections.
The TCP server adapter waits for native close acknowledgement before allowing the port to be reused.
The sheet groups mappings into cards with an on/off switch, address/open controls, target details and last-edited time.
Use a card's **更多操作 → 编辑映射** to change it in place, or **删除映射** to remove it. Cancel discards the form draft.
The list can be sorted by last-edited time. Desktop exposes a pencil button beside each mapping.

Android retains a foreground service while any mapping is active, with a **端口映射** notification.
Mapping leases are independent of background chat. The service adds the `connectedDevice` type while
mapping, and removes it after the last mapping stops. Start is allowed only while the app is visible;
the listener remains active after opening an external browser. This requires a newly built APK.
Force-stopping the app, signing out, or losing the remote connection stops mappings.

iOS supports the same listener and in-app preview. An external browser can be opened, but iOS may
suspend the app in the background. The UI recommends the in-app preview for this reason.

## Web

Port mapping is available in the desktop and phone apps. The Web client does not expose port mapping
or embedded mapping previews. Existing saved settings remain available to the desktop and phone apps.

## Configuration synchronization

Deploy `apps/admin/sql/20261015-port-mappings.sql` before updating admin-go, then update the clients.
Fresh databases include the identical `015_port_mappings.sql` migration. The authenticated
`GET/PUT /devices/:deviceId/port-mappings` endpoint checks device ownership and is covered by the existing
Kong `/devices` JWT route (`strip_path: false`). No public route or new mapping listener is needed.
The configuration table is keyed by owner and remote device, and cascades when that device is removed.

Clients sync immediately after configuration changes and poll every five seconds while that computer's
workspace is mounted. Requests are single-flight and stop on unmount/sign-out. Offline edits and deletions
are persisted and retried. Stable IDs and revision-checked writes merge unrelated concurrent changes without
replacing the whole collection with stale local data. After a revision conflict the client fetches again and
reapplies only its pending edits; for the same mapping, the last accepted edit wins. Unchanged old caches do
not resurrect deleted mappings. Identical legacy local settings are imported once.

Only IPs, ports, protocols, IDs and edit timestamps sync. Listener state remains local: a newly received mapping is stopped;
an already-running mapping applies remote edits by restarting locally. Remote deletion stops its local listener.
Unavailable/older servers show a retry notice while local mapping continues to work. Configuration sync needs
the new server and client versions; this source change does not deploy the migration or install updated apps.
UDP configuration uses the existing JSON column, with no new migration or Kong route. Update admin-go to retain
the optional `protocol` value (`tcp`, `udp`, `both`). If an older server drops this field, the client retains the
local protocol and pending edit, and shows that protocol settings have not synced instead of downgrading to TCP.

## UDP transport

Both endpoints must be updated for UDP; the phone app needs a rebuilt native binary. UDP uses origin-bound
`guiResourceLink` sessions over the existing encrypted chat transport. Each datagram retains its boundary and
an opaque client ID. The remote host creates a separate connected UDP socket for each local client, accepts
replies only from the configured destination, and routes them back to that client. IPv4 and IPv6 targets work.
UDP startup confirms the mapping is ready, not that the remote service is listening: UDP has no connection handshake.

UDP listeners and connections require protocol version 2; older peers must update, with no legacy fallback.
Sessions accept up to 64 clients and 65,507 bytes per datagram, including empty datagrams. Batches drain
immediately available packets up to 64 datagrams or 256 KiB of payload, whichever comes first. They never wait
to fill a batch. Each direction queues at most 512 datagrams and 2 MiB of payload. Empty datagrams count against
the packet limit. Byte permits remain charged while a native socket write is pending, and a datagram deferred
at the batch byte limit is retained for the next read. Both limits also apply to the phone's listener.
Sustained overload can still drop datagrams, but small bursts no longer exhaust a 32-packet queue while awaiting
the preceding remote write. A complete batch is validated before any of its packets are submitted.
The phone submits each validated reply batch together and awaits all native send callbacks; it does not
serialize an additional JavaScript/native round trip for every reply. The batch count and byte limits
also bound these in-flight sends.

Windows hardware verification (2026-10-17, updated viewer and ZH2 host, local UDP `15353` through ZH2
to LAN DNS `192.168.5.1:53`): four clients sending 128 requests without pacing previously received only
33 / 34 replies. Three runs with version 2 received 128 / 128 replies, with no duplicates or client mix-ups;
burst median RTT was 26–37 ms and p95 34–44 ms. Forty requests spaced 30 ms apart remained loss-free at
7.2–7.5 ms median; 80 requests from four clients spaced 5 ms apart all returned at 5.9–6.5 ms median.
Direct LAN controls previously received all 128 burst requests. This fixes forwarding burst loss, not
the underlying difference between encrypted forwarding and direct LAN access.

Two additional real ZH2 loopback echo runs preserved every byte and client identity for 128 / 256 / 512
packet bursts with 128-byte payloads, 128-packet bursts with 1,200-byte payloads, empty datagrams,
16 paced 16-KiB datagrams and four paced 65,507-byte datagrams. An unchanged client socket worked after
95 seconds idle (7.6 ms reply), and three stop/start cycles immediately released and reused the port.
TCP port 3002 also returned HTTP 200 and a 12,711,048-byte asset matching the direct LAN SHA-256 after
updating the host. These are bounded test scenarios, not a guarantee against loss under sustained overload.

The rebuilt Android APK was installed on a 2109119BC phone and tested against the same ZH2 DNS mapping.
Two foreground runs and one background run each returned all 40 paced, 80 multi-client and 128 burst
requests without duplicate or misrouted responses. Burst median RTT was 102–177 ms and p95 146–226 ms;
phone forwarding still has higher latency than the desktop path. Web build and shared protocol checks
passed; browsers continue to omit local port listeners.
Peer associations expire after 60 seconds without traffic in either direction. Sessions expire after 90 seconds
without client polling/writes, and disconnect/stop cancels pending reads and releases listeners before returning.
UDP shares the selected P2P/relay transport, which may be reliable and ordered; it does not promise the latency or
loss behavior of a direct UDP network path.

The phone adapter uses `react-native-udp`. `scripts/patch-udp.cjs` adds the Android namespace, resets reused receive
packet lengths, and enforces exclusive port binding on Android/iOS. Keep these patches when upgrading the dependency.

## Transport and lifecycle

The viewers reuse `guiResourceOpen` and `guiResourceClose` over the selected computer's authenticated
chat connection. Desktop and mobile clients negotiate `portStreamsV1` with the host, then use
`guiResourceStream` only to open/close a TCP socket. Bytes flow continuously on the existing encrypted
binary channel (native direct stream, WebRTC data channel, or CSF1 server relay), independently of
chat RPC framing. No additional public listener or backend route is needed. The resource URL identifies
the permitted remote TCP address; the native TCP forwarding path preserves application bytes.

Each socket has independent offsets, a 2 MiB window per direction, cumulative acknowledgements and
bounded retry storage. Acknowledgements replenish credit only after the consumer reads the bytes.
Late/out-of-order records are authenticated and deduplicated, and a P2P/relay switch retransmits only
unacknowledged bytes without reopening TCP. Records are at most 16 KiB and adapt to smaller negotiated
path limits. Stalled writes fail after 30 seconds. A link permits at most 24 stream handles, covering the
eight active requests, bounded idle connections and sockets awaiting cleanup. Resource/session closure
releases the remote sockets, ciphers, timers and native receive routes.

Mobile port mappings require `portStreamsV1` and an available binary path. Unsupported peers report
an update requirement; receiver failure requires reconnecting the authenticated link. There is no
automatic RPC downgrade or legacy Android receiver. Startup probes the stream before opening the listener.
Android requires a rebuilt APK containing the duplex connectivity and native stream decryption modules.
The receive-only epoch key is handed to a native poll worker, which authenticates records and enforces
a 4,096-entry replay window across direct/relay arrivals. Before opening the host stream, Android binds
its accepted loopback TCP socket to the authenticated stream identity. Download DATA/END frames stay
native: a bounded reassembler handles overlaps and gaps, then a single-flight worker writes contiguous
bytes directly to that socket. Only coalesced consumed offsets, EOF and small control frames cross JS.
Credit advances after a socket write completes. Each receive window is 2 MiB, including any in-flight
write, with at most 4,096 fragments and 384 KiB per write. At most 24 sockets can be bound across receivers;
slow writes do not block other sockets or decrypt workers and close after 30 seconds. Closing a stream
releases its binding, queued bytes and socket. The dependency patch exposes only accepted, connected,
plaintext loopback sockets through a focused in-process API and rejects source/version drift.
Uploads still use the bounded JS stream path. Shared consumers without a local TCP socket retain the
authenticated frame API; byte-range deduplication and direct Base64 decoding bound their bridge overhead.
The exported key is cleared after registration, and route cleanup destroys the native key. Wire format,
per-socket credit and authenticated resource scope are unchanged. iOS uses bounded native IPC batches
for mesh transport and the shared binary implementation for RTC/relay. Web has no local port listener;
its shared stream clients enforce the same capability requirement.

Desktop manual TCP mappings use `DesktopMappingTunnel` and require `portStreamsV1`, just like mobile.
`TerminalLinkTunnels` remains the separate terminal-link preview implementation.
The asynchronous Rust listener validates the requested port and
releases its bound socket before completing a stop, even with a pending accept. Manual mappings
share an eight-stream concurrency budget per computer to retain chat RPC and cleanup capacity. Additional
connections wait in FIFO order for up to 30 seconds instead of being closed as soon as the budget is full.
The desktop accepts at most one waiting socket per listener and leaves further connections in the TCP backlog.
Native sockets pause while waiting to preserve their initial request bytes. Stopping a mapping cancels
its queued connections without affecting other mappings.
A failed listener or disconnected session requires restarting its mapping.

Desktop download records are intercepted before the native direct/relay IPC bridge. Rust authenticates
the receive-only epoch key, enforces a 4,096-entry replay window, reassembles bounded byte ranges and
writes accepted loopback sockets directly. Browser RTC arrivals are batched into the same native
receiver. All paths share one replay state and socket offset; there is no RPC fallback. Only coalesced
consumed offsets, EOF and control frames return to the renderer. Uploads use raw local read batches
and the continuous encrypted binary stream, rather than remote read/write RPCs.
Receivers are application-owned, main-WebView-only and expire after 30 seconds without control polling.
There are at most eight receivers and 24 native sockets. Each socket retains at most 2 MiB including
an in-flight write, at most 4,096 fragments and 384 KiB per write. Writers run independently, cancel on
mapping/receiver closure, and fail blocked writes after 30 seconds. Only an accepted socket belonging
to an active local listener can be transferred into the sink; terminal and remote socket handles cannot.
Late records from retired sockets are discarded after authentication. An invalid receive window fails
only its socket; failed progress cannot be overwritten by a racing writer completion. Receiver-wide
failures release the native receiver and reconnect the authenticated chat link, so restarting a mapping
uses a new epoch instead of remaining attached to a permanently closed multiplexer. Normal mapping
stops do not reconnect chat. Native diagnostics record failure stages without payloads or key material.

The host's local socket bridge uses a uniform 384 KiB read/write bound. The host returns
as soon as data is available and drains only immediately readable bytes; small replies and WebSockets
never wait for the larger buffer to fill.

## Verification

- UDP Rust tests cover real binary/empty/maximum-size datagrams, client isolation, origin/owner authorization,
  TCP/UDP coexistence, port conflicts, cancellation and immediate reuse. TypeScript tests cover combined-mode rollback,
  late startup cleanup, protocol edits/sync, old-server protection, and datagrams over encrypted P2P/relay switching.
- Native tests exercise actual loopback UDP sockets behind the mobile adapter plus protocol selection and copy-only UDP UI.
  Android module compilation and Android/iOS Metro exports pass; iOS native compilation and device testing require macOS.
- `ANDROID_SERIAL=<device> node apps/native/scripts/test-udp-sockets.cjs` runs the compiled production UDP adapter
  on Android without replacing the installed app (compile `:react-native-udp:compileReleaseJavaWithJavac` first).
  Android hardware verification on 2026-10-17 passed empty/binary/65,507-byte datagrams, changing packet lengths,
  exclusive binding and immediate reuse. This checks the socket adapter, not a full app WAN session.
- Playwright checks protocol selection, editing, persistence and the compact narrow-screen layout alongside TCP regressions.

- `portForwarding/byteStream.test.ts`, `streamMux.test.ts`, `streamClient.test.ts` and
  `streamIntegration.test.ts` cover bounded credit, cancellation, unsupported-peer rejection, encryption,
  replay/forgery, shrinking path limits, concurrent upload/download, shared file/port transport and live P2P/relay switching.
- Android `ANDROID_SERIAL=<device> node apps/native/scripts/test-port-streams.cjs` checks native decryption,
  an independent Node crypto vector, replay, byte-range deduplication, reordered records, forged headers/tags, routing,
  ownership, queue limits, overflow cleanup, close/poll races and the duplex JNI entrypoint on hardware,
  without replacing the installed app. Build the arm64 APK/native library first. This is bridge-level
  device verification; full app WAN browsing and iOS device performance require separate measurement.
- The same Android checks exercise encrypted direct/relay records written to a real loopback socket
  without passing DATA through JS, overlapping/reordered retransmissions, early END, receive-window and
  fragment limits, blocked-writer credit and write-timeout cleanup. Shared tests verify native bind/open
  ordering, consumed-only ACKs, path-change ACK replay, failure isolation and EOF after drain.
- Android hardware performance (2026-10-17, 2109119BC, Chrome 155, cache disabled): the same development
  page on port 3002 loaded in 62.42 s before optimization and 23.28 s after (532 requests, no failures).
  Same-phone LAN controls were 4.16 s before and 4.64 s after. The page transfers roughly 50 MB of
  uncompressed development assets; this is not a production bundle benchmark. A standalone 12,711,048-byte
  asset through the phone mapping and ADB TCP forward fell from 14.84 s to 5.02 s. The Android app
  runs in the background during browser verification. Native filtering removes repeated byte ranges
  before they cross the JS bridge; it does not remove encryption or change remote resource authorization.
- A second optimization on the same phone writes authenticated downloads directly into the accepted
  loopback socket. Two cache-disabled runs loaded the page in 10.92 s / 10.99 s, versus same-run LAN
  controls of 4.23 s / 4.20 s (531 requests, roughly 50.7 MB, no failed requests, login rendered).
  The standalone 12,711,048-byte asset took 1.94 s with the app foregrounded and 2.75 s with Chrome
  foregrounded, versus 5.02 s after the first optimization. SHA-256 matched the direct download.
  This is a substantial reduction in forwarding overhead, but
  mapped page loading is still slower than direct LAN access. The host and development server were unchanged.
- For actual duplex JNI bytes, first run `cargo test --lib bulk::android_fixture::android_duplex_bridge_fixture
  -- --ignored --nocapture` in `crates/chat-connectivity`, then run the Android script above with `--duplex`.
  On 2026-10-15, the phone received and echoed 4 MiB in 1.24 seconds through an ADB loopback fixture;
  the host verified every byte before the phone reported success. This is not a public-network benchmark.

- Rust `gui_terminal::links` tests cover fixed-port conflicts and reuse, cancellation, independent
  listeners, scoped binary transfers and WebSocket forwarding.
- `portForwarding/service.test.ts` covers concurrent mappings, validation, startup cancellation,
  late replies, cleanup, retries and disconnects. Settings tests cover device isolation and corrupt data.
- `portForwarding/streamTunnel.test.ts` checks binary upload, idle accept polling, stop/late-attach cleanup
  and rejection of peers without stream support. `streamBridge.test.ts` checks bounded RTC batches,
  native binding and control/progress delivery. `transport.test.ts` checks encrypted UDP forwarding.
- Rust `port_mapping` tests verify an independent Node crypto vector, replay/authentication, reordered
  overlapping data, native TCP writes, consumed-only credit, cancellation and independent slow/fast sockets.
- Desktop hardware verification (2026-10-17, Windows viewer, local `127.0.0.1:3002` to ZH2 port 3002):
  the 12,711,048-byte asset fell from a five-run median of 3.92 s to 1.24 s. All downloads returned HTTP 200
  with the same SHA-256 as the direct LAN control (68 ms median). Six concurrent copies fell from
  30.15 / 34.90 s to 7.46 / 7.32 s. Small keep-alive requests remained about 9 ms versus 2 ms direct.
  Three cache-disabled full-page runs took 7.35 / 6.95 / 7.12 s, versus 14.43 / 23.37 s before this change.
  These are approximately 50.7 MB development pages with about 530 resources, not production bundles.
  The login page rendered in every final run. Direct LAN page loads took 1.65 / 1.52 s;
  the P2P indicator alone does not establish that every packet stayed on the LAN. ZH2 and its application
  were not upgraded for this PC change. Measurements use a separate viewer profile running the final code.
- Desktop recovery verification deliberately suspended that viewer's renderer for 48 seconds. Native logs
  recorded lease expiry and polling failure; after the renderer resumed, the authenticated connection
  recovered and manually restarting the mapping restored HTTP 200 and a complete browser page without
  restarting the viewer. Minimized viewing, switching to the local workspace, idle requests and rapid
  reloads also passed. This verifies recovery from receiver loss, not the precise trigger of an earlier
  spontaneous failure. Regression tests also isolate invalid socket offsets and reject stale failure
  callbacks from a retired connection. End-to-end TCP half-close behavior with older hosts remains unverified.
- `terminal/linkTunnelConcurrency.test.ts` transfers 24 concurrent HTTP responses over real loopback sockets
  while keeping an upgraded connection and chat RPC available, and checks cancellation and immediate port reuse.
- `terminal/linkTunnelLatency.test.ts` compares 48/384 KiB read sizes with a 1.5 MiB HTTP asset and 60 ms simulated
  RPC RTT: 33 reads / about 2.3 s versus 5 reads / about 0.45 s. This measures tunnel overhead, not a live site's load time.
  Rust chunk tests verify immediate small responses, large binary transfers and size validation;
  transport tests carry the larger chunks through encryption and P2P/Relay switching.
- `portForwarding/streamBudget.test.ts` covers FIFO admission, cancellation, bounded waiting and slot reuse.
- `e2e/port-forwarding.pw.ts` covers form actions, preview/browser opening, copying, errors, reconnects, device switching,
  persistence and compact light/dark layouts; `e2e/remote-gui.pw.ts` verifies the real workspace entry.
- Native `portMapping` tests cover real TCP/HTTP transfer, binary bytes, port conflicts, reuse and background leases.
- Android hardware verification (2026-10-15): over P2P to a paired Windows 11 VM, remote loopback `17631`
  mapped to phone loopback `17632`. In-app preview, external Mi Browser opening and background refresh,
  copying, stopping and immediately restarting the same port passed. Foreground service type changed from
  `remoteMessaging|connectedDevice` to `remoteMessaging` after the mapping stopped.
