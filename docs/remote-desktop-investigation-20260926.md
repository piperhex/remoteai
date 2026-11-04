# Remote desktop 1.6.2: device measurements and implementation research

Investigation date: 2026-09-26. This records observed limitations and proposed engineering work;
it does not announce a performance fix or a deployed video relay.

The subsequent implementation and real-device/public-relay results are recorded separately in
[implementation validation](remote-desktop-validation-20260926.md).

## Physical-device results

The viewer was a Xiaomi Civi 1S running Android 14 and the official mobile 1.6.2 release.
The host was a Windows 11 Hyper-V guest running the official desktop 1.6.2 release.
Both releases were installed without clearing user data. Measurements used a continuously animated
desktop, a manual 60 FPS cap, and the clear image-quality setting. Static-screen FPS is not a useful
measure of a remote desktop's maximum throughput.

| Host session | Actual video size | Sender FPS | Android rendered FPS | Android dropped frames |
| --- | --- | --- | --- | --- |
| Hyper-V enhanced session | 1708 × 960 | about 15–16 | about 15.7–16 | 0 in sampled intervals |
| Hyper-V basic console | 1024 × 768 | about 17–18 | about 16.7–17 | 0 in sampled intervals |

Sender values came from WebRTC outbound video statistics. Receiver values came from Android
libwebrtc `EglRenderer` four-second statistics, not the React Native UI's rendering rate.
The selected media candidates were `host` / `host`. One basic-console sample reported 7 ms RTT,
17 FPS, H.264, about 1.29 ms average video encoding time and no current encoder limitation.
RTT varied between samples; it was not a controlled network benchmark.

These results identify a host-side bottleneck before transmission. They do not establish a universal
limit for Hyper-V, Windows or this phone, nor do they demonstrate 60/120 FPS end-to-end.
The enhanced session's display reported 32 Hz. Switching to the basic console did not remove the
capture bottleneck. No display-driver changes, registry tuning or guest reboot were performed.

## Capture experiments

Production 1.6.2 uses this sequence:

```text
GDI capture + resize → BGRA-to-RGB → JPEG encode → binary Tauri IPC
  → WebView JPEG decode → canvas → WebRTC video encode → network → native phone decode/render
```

The work runs outside the Tauri UI thread and capture is single-flight, but the sequence still
performs multiple copies and two encodes with a decode between them. A configured FPS cap does not
make this sequence finish within the 16.7 ms budget for 60 FPS or 8.3 ms budget for 120 FPS.

Standalone probes measured capture without transmitting or storing desktop pixels:

| Probe | Observed result | Interpretation |
| --- | --- | --- |
| GDI in the basic guest console | about 45–49 ms per copy | Already exceeds a 60 FPS frame budget |
| DXGI staging readback, guest 1024 × 768 | about 20.5 acquired frames/s; 25.3 ms copy/map | DXGI alone did not solve this guest's bottleneck |
| DXGI `MapDesktopSurface`, same guest | 113 frames / 5.508 s; 24.796 ms copy/map | System-memory path was available, but did not materially improve throughput |
| DXGI staging readback, physical Windows host 2048 × 1152 | about 143.9 acquired frames/s; 3.43 ms copy/map | Capture-only result on different hardware; not phone playback FPS |

The DXGI probe kept its duplication object alive, used a continuously changing visible desktop,
and copied each acquired mapped surface. Its FPS includes acquisition waits; its copy/map time
also includes copying mapped bytes into an owned buffer. A prior run with an idle/black display
produced no frames and was excluded. GDI allocation caching and removing `CAPTUREBLT` did not
produce a useful improvement in the guest. Earlier DPI-unaware probes have different dimensions
from the packaged application and should not be treated as equal-resolution comparisons.

A local build sending raw pixels through Tauri IPC instead of JPEG reduced phone playback from
about 17 FPS to about 13 FPS at 1024 × 768. It was rejected and the official executable restored.
Experimental increases to automatic FPS profiles were also withdrawn: they did not establish an
improvement to the capture pipeline. No production capture or adaptation changes are included here.

## Why the chat Relay label does not imply video relay

The authenticated chat connection carries desktop offer/answer, ICE and display settings. Video
and controls use a separate WebRTC peer connection. The Go coordinator's `iceServers` implementation
in `apps/admin/internal/devices/stun.go` accepts only STUN URLs, and the shared `IceServer` type
contains only `urls`. There is no TURN credential provisioning or video relay in this path.

Chat can therefore work through its WebSocket relay while the desktop media connection fails on a
network that prevents direct peer connectivity. Conversely, a chat Relay connection can still carry
desktop signaling for media that connects directly. The chat transport label alone cannot identify
the video route. LAN success does not validate relay operation.

## Approaches used by mature open-source projects

| Project | Relevant design | Application to this repository |
| --- | --- | --- |
| RustDesk | DXGI capture, a system-memory mapping path, hardware encoder options and GDI fallback; separate rendezvous and relay services | Capture recovery and real relay fallback are useful references; its relay protocol is not TURN |
| Sunshine / Moonlight | GPU-oriented Windows capture and conversion, hardware video encoding, native client playback | Reference for reducing capture-to-encoder copies and pursuing high FPS |
| coturn | WebRTC-compatible TURN with UDP/TCP/TLS client transports and expiring credentials | Fits the existing native and browser WebRTC receivers |

Primary sources reviewed:

- [RustDesk DXGI capture](https://github.com/rustdesk/rustdesk/blob/master/libs/scrap/src/dxgi/mod.rs):
  selects `MapDesktopSurface` when `DesktopImageInSystemMemory` permits it, otherwise uses readback.
- [RustDesk video service](https://github.com/rustdesk/rustdesk/blob/master/src/server/video_service.rs):
  includes hardware encoder paths and texture-oriented capture handling.
- [RustDesk server documentation](https://rustdesk.com/docs/en/self-host/rustdesk-server-oss/install/):
  distinguishes the signal/rendezvous server `hbbs` from the relay server `hbbr`.
- [Sunshine overview](https://docs.lizardbyte.dev/projects/sunshine/latest/) and
  [Windows GPU capture/conversion implementation](https://github.com/LizardByte/Sunshine/blob/master/src/platform/windows/display_vram.cpp):
  describe hardware encoding and show the GPU-oriented Windows path.
- [Moonlight overview](https://moonlight-stream.org/): advertises 120 FPS streaming for the PC client;
  that is not a guarantee for this phone or virtual display.
- [coturn documentation](https://github.com/coturn/coturn): documents TURN transports,
  time-limited authentication, bandwidth limits and monitoring.
- [Microsoft Desktop Duplication API](https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/desktop-dup-api):
  describes desktop surfaces, updates, rotation and cursor handling.

This investigation uses design references; it does not incorporate third-party source code.
RustDesk's [AGPL license](https://github.com/rustdesk/rustdesk/blob/master/LICENCE) and
Sunshine's [GPL license](https://github.com/LizardByte/Sunshine/blob/master/LICENSE) must be considered
separately before adopting their implementations.

## Proposed implementation and acceptance criteria

1. **Make media relay work.** Provision authenticated, short-lived TURN credentials through
   `apps/admin`; preserve them across the shared protocol, desktop, native and Web clients.
   Deploy coturn with the required listener/relay ports and certificate configuration. Integrate
   allocation limits and traffic accounting with the existing quotas. A public unauthenticated
   relay or a chat-label change is not a substitute for this work.
2. **Replace the host video path.** Benchmark DXGI and Windows Graphics Capture against the actual
   active display adapter, then feed captured surfaces into a native video encoder/WebRTC sender
   with bounded queues. Preserve Android/iOS native decoding and browser WebRTC compatibility.
   Handle cursor composition, rotation, display changes and capture loss; retain a tested fallback.
   A GPU/encoder available on the physical host cannot be assumed available inside Hyper-V.
3. **Revisit adaptation after the pipeline is measurable.** The present recovery threshold asks
   for more bandwidth than the next profile while the sender is still capped at the lower profile.
   Validate recovery with startup ramp-up, quiet desktops, stable low bandwidth and real congestion.
   Simply relaxing the threshold can cause repeated upgrade/downgrade oscillation.

Acceptance requires a sustained changing scene on the physical phone and Web viewers at the same
resolution and quality, with sender FPS, rendered FPS, drops, RTT and selected ICE candidate types
recorded together. For 60/120 FPS, verify display refresh, capture throughput and encoder availability
independently. For relay, force `iceTransportPolicy: 'relay'` in a test setup, confirm the selected
candidate is `relay`, and exercise input, reconnect, expired credentials and quota enforcement.
Repeat across different networks, including a UDP-blocked case using TURN over TCP/TLS.
