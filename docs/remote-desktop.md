# Remote desktop

See [reliability, host permissions and notification setup](remote-reliability.md) for the latest recovery,
live encoder control, clipboard channel negotiation and host identity behavior.

The phone and Web chat toolbox opens the selected computer's remote desktop. Windows hosts support choosing
any connected display under **Display → Monitor**, with its Windows display number, resolution and primary marker.
Switching releases held mouse buttons and reconnects video and sound to the chosen screen, retaining quality,
frame rate and mute settings. Zoom resets to fit the new screen. Capture and input share the selected display's
physical pixel bounds, including negative coordinates, portrait screens and mixed DPI. Native GPU, GDI,
FFmpeg and WebView compatibility capture all honor the selection. Reconnection refreshes the display list;
if the selected display was removed, it returns to the primary display and updates the selection.
Older hosts without display discovery keep their existing single-screen controls.
macOS 13 and later hosts also support video, display selection, mouse/keyboard control and clipboard
copy/cut/paste (including files and images). Open **Remote settings → Mac access permissions** on the Mac
and grant Screen Recording to Remote AI; grant Accessibility when mouse/keyboard control is enabled.
These grants are shared with Computer Use, but that plugin does not need to be installed. Capture startup
requests a missing grant once per permission per app run; reading permission status never prompts.
Native and Web viewers wait for grants without reopening capture, then connect automatically when access is available.
The local permission buttons remain available; restart Remote AI if macOS requests it.
See [Mac permission requests](remote-desktop-permissions.md). Keep the app running in a logged-in desktop session.
Linux hosting remains unsupported.
The native and Web keyboard panels use Cmd/Option and Mac shortcuts when connected to a Mac; hosts that
do not report their platform retain the existing Windows keyboard layout.
The viewer works on Android/iOS through `react-native-webrtc` and on Web through the browser's WebRTC engine.

## iPhone and iPad

Open the connected computer's chat toolbox and choose remote desktop in an installed native iOS build.
The native receiver uses libwebrtc and `RTCMTLVideoView`; it does not request camera or microphone access.
The local-network permission description covers chat and desktop connections. The transport Expo plugin must
be registered before WebRTC's permission plugin because Info.plist mods execute in reverse order; otherwise
the WebRTC plugin restores the unused microphone permission. The generated configuration is regression tested.
See Apple's [local network privacy guidance](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).

The full-screen native viewer supports portrait and both landscape orientations, preserving the home-indicator
safe area on iPhone and iPad. On iOS, automatic landscape waits for the native Modal's `onShow` callback,
which fires after presentation completes, and runs only once per presentation. Requesting the orientation
lock during mount races UIKit's full-screen presentation. A late callback after closing must not rotate the
chat. Keep this ordering when changing the viewer; JavaScript error handling cannot catch a native UIKit
exception. See the [React Native Modal lifecycle](https://reactnative.dev/docs/0.79/modal#onshow).
Web also preserves the bottom safe area in landscape, fits text and display
settings to the visual keyboard viewport, and only offers browser fullscreen when the browser supports it.
Remote video continues to play inline, so its mouse and keyboard controls remain accessible.

`npm run export:ios -w @codex-switch/native` checks the iOS production JavaScript bundle on any development host.
The release workflow builds the native iOS app on macOS. The Web desktop Playwright suite includes iPhone and
iPad WebKit layout tests; Windows WebKit does not provide WebRTC, so those tests deliberately hold signaling
pending. Chromium tests separately exercise real video/control transport. These checks do not replace an
iOS device check of H.264 playback, local-network permission, rotation, keyboard and background/resume behavior.

## Media and threading

Windows hosts also capture the default playback device through WASAPI loopback. The bundled native helper
encodes 48 kHz stereo Opus in 20 ms frames and sends it alongside negotiated H.264/H.265 video
in the same WebRTC stream.
Audio stays off the UI thread and outside JavaScript. Capture timestamps preserve spacing across pipe reads;
bounded buffers discard stale sound. Silence keeps the media clock moving when the computer is quiet.
The host retries audio after an output device change or failure without interrupting desktop video.

Native and Web viewers start with sound enabled and offer a sound/mute button. If a browser blocks sound
autoplay, video continues muted and the button offers **Enable sound**. Closing the desktop stops both tracks.
Android uses media audio attributes; iOS uses a playback-only audio session, retaining headphone/Bluetooth
output and avoiding microphone capture. The version-pinned WebRTC playback patch is applied during Expo
configuration. A new native build is required for these audio route changes.

An old host, missing native runtime, unavailable output device or the legacy WebView capture fallback can
still show video without sound; the sound button is unavailable in that case. Linux hosting remains
unsupported. macOS hosting currently sends video without system audio and does not offer the Windows
unattended/secure-desktop service.

macOS capture uses Apple's ScreenCaptureKit and VideoToolbox H.264 encoder in a bundled universal helper.
The shared native WebRTC path handles ICE, TURN, direct upgrades, clipboard and authenticated session expiry.
Video dimensions are physical pixels; Quartz input coordinates use each display's logical point bounds,
so Retina scaling and displays positioned left of or above the primary screen do not shift pointer input.
Closing, expiry and permission changes release held input. The helper stops on stdin EOF or host cancellation;
bounded output buffers and periodic still-screen frames keep video responsive without unbounded backlog.

On a Mac, run `node scripts/prepare-remote-desktop-runtime.mjs` before `tauri dev`; `build:app` and the release
workflow prepare the helper automatically. The build compiles both Apple Silicon and Intel slices, signs the
helper, and runs a synthetic H.264/keyframe/framing self-test that does not need Screen Recording access.
The macOS CI workflow checks Rust on both architectures. A real logged-in Mac is still required to verify
the system permission prompts, Retina/secondary-screen clicks, dragging, text/Command shortcuts and live
video received on the native and Web viewers.

- The existing authenticated, end-to-end encrypted chat connection carries offer/answer, ICE and display settings.
  Host ownership is the individual chat session, not a client-supplied owner or the persistent terminal owner.
- A separate WebRTC connection carries video and system audio with DTLS/SRTP encryption and an ordered control DataChannel.
  It uses the ICE servers supplied by the authenticated coordinator. Updated native viewers and hosts also add
  an ephemeral loopback TURN adapter backed by the existing chat EasyTier engine. Its virtual UDP sockets carry
  media through that engine's authenticated direct route; adapter credentials never cross the desktop RPC.
  This reuses chat UDP/TCP hole punching and IPv6 without sending media through JavaScript or chat framing.
  Optional public TURN UDP/TCP/TLS supplies a media
  relay when direct connectivity fails. Chat WebSocket relay and video relay remain separate connections.
  The desktop overlay reports the selected video candidate route, independently of the chat's P2P/Relay label.
  A local adapter pair counts as direct only after verifying its issued virtual addresses and the native route.
  Direct upgrade probes retain local adapters while excluding public TURN. Closing the view or chat grant releases
  adapters; old binaries and ordinary Web viewers continue with their existing WebRTC connectivity.
  Updated viewers negotiate `relayStandby` with the host. A relay used before direct promotion stays connected;
  a session that starts direct establishes a separate public TURN-only backup. The native adapter is excluded
  from that backup so it remains independent of the direct route. Standby control heartbeats run every two seconds,
  with six seconds of silence marking the backup unavailable. Backup repair waits at least five seconds between
  attempts and never replaces the working direct session. Standby peers do not receive continuous audio/video.
  Direct failure activates the retained relay through its own encrypted control channel, without waiting for chat
  signaling or restarting capture. A standby heartbeat arriving before the promoted direct peer's first ping
  is ignored until the relay is registered; it never enters keyboard/mouse parsing or renews an unregistered peer.
  Direct retries use 5/15/30/60-second backoff, including direct connections that fail within 30 seconds.
  Automatic media reconnects retain that backoff; 30 seconds of stable direct service resets it. Closing the
  desktop releases both peers. Older hosts keep the previous reconnection behavior until updated.
  See [video relay deployment](../apps/admin-go/DESKTOP-RELAY.md) for credentials, quotas and network requirements.
- Android receives encrypted media directly in native libwebrtc. Decryption, jitter buffering and decoding
  run on native WebRTC threads; `RTCView` renders through `SurfaceViewRenderer`. JavaScript receives only stream
  handles, low-frequency statistics and small control messages. It never receives video frames/base64 data.
  The sender prefers H.264 for Android's native hardware decoder and retains negotiated native software fallback.
- Windows first uses DXGI Desktop Duplication in the native `desktop-video` helper, on the adapter belonging
  to the selected monitor. Owned GPU textures survive frame release; D3D11 handles scaling, color conversion
  and monitor rotation. NVENC is preferred, with Media Foundation hardware encoding as fallback. Unchanged
  desktop frames skip encoding. WGC remains a user-session fallback, followed by compatible capture backends.
- The unattended SYSTEM worker also tries DXGI first instead of forcing software capture. If duplication is
  unavailable, it tries GDI capture with GPU upload/hardware encoding, then GDI/OpenH264 for H.264 sessions.
  Desktop switches/access loss restart capture under the existing authorized lease, refreshing monitor dimensions.
  GDI still pays for capture/comparison; enabling its hardware encoder does not remove that capture bottleneck.
- Receivers advertise H.265 only when WebRTC lists it and MediaCapabilities reports power-efficient decoding.
  Missing APIs, failed probes, unsupported devices and older clients retain H.264. The Windows host probes
  hardware HEVC before creating its offer; if unavailable, it offers H.264. Codec identity stays fixed across
  quality changes, capture restarts, direct probes and relay recovery; SDP only offers the selected video codec.
  macOS hosting and native mobile receivers without this capability probe retain their existing H.264 path.
  Update both desktop clients and the installed unattended service/runtime to enable the new pipeline.
- The connection statistics panel shows the capture method and negotiated receive codec.
  Hardware/software encoding and decoding modes remain in the statistics payload but are not displayed.
- A recovery frame is sent at most two seconds after the previous update, with periodic intra frames, so an
  idle desktop can recover from packet loss. Damage stays pending across FPS throttling. The helper outputs
  length-delimited access units with encoder buffering disabled; the final update does not wait for another
  captured frame. Rust buffers incomplete pipe reads across polling cancellation. RTP timestamps advance
  before a resumed frame, so idle time does not become playback delay on the following update.
- This is capture-side damage gating plus standard H.264/H.265 inter-frame compression, not a rectangle-patch wire
  protocol. Partial changes still produce a complete decodable video frame. Android/iOS native WebRTC and Web
  viewers keep their existing receivers and hardware-decoder compatibility. FPS can fall close to zero when
  idle without indicating a stalled connection. Frames remain outside WebView/JavaScript IPC.
- A checksum-pinned LGPL shared FFmpeg runtime is bundled by the desktop build script; the helper dynamically
  links its DLLs. Licenses, source references and helper rebuild instructions accompany it.
- Native video uses bounded queues, NACK/RTCP feedback and periodic keyframes. It reduces bitrate after loss
  or insufficient reported capacity and probes upward after three healthy samples. Capture stops while ICE
  connects, then restarts to discard startup backlog. Frame selection preserves source timing instead of
  padding a slow display with repeated frames. Native input runs on blocking workers with an expiring lease.
- Native automatic mode starts at the maximum supported width (2560 pixels) / 60 FPS / 12 Mbps,
  capped to the source display without upscaling. Congestion lowers FPS in steps of 10 to 30 before reducing
  automatic resolution. Bitrate follows the pixel/frame budget to preserve per-frame quality. Manual FPS
  accepts integers from 1 to 144 and sets the recovery ceiling; manual quality keeps its resolution.
  Downgrades require three fresh congestion samples, with independent loss and capacity evidence counters.
  A low bandwidth estimate only establishes a shortage
  when actual video traffic approaches the current encoding budget; a quiet desktop's low traffic is not
  evidence that its configured maximum is unsustainable. Three fresh healthy loss reports allow one recovery
  step, restoring resolution before FPS above 30. Independent capacity reports do not erase this recovery
  history, and busy streams do not repeatedly probe above a still-insufficient capacity estimate.
  Stale or already-consumed network reports cannot trigger repeated adaptation.
  These are limits, not guarantees: source refresh, GPU/CPU, decoder and network
  capacity all matter. Hyper-V's enhanced display can limit genuine capture to approximately 30 FPS even on a fast LAN.
- When the native runtime or capture is unavailable, the original GDI/JPEG → WebView canvas → browser WebRTC
  sender remains a compatibility fallback. It shares the same initial quality and frame-first adaptation policy,
  and configures browser WebRTC to maintain resolution before initial, direct-upgrade and standby connections
  can transmit. Stable relay latency is learned as a baseline, rather than treated as congestion solely because
  it exceeds a fixed threshold. Browser feedback uses measured outgoing traffic and fresh Receiver Reports;
  CPU pressure alone cannot lower bitrate after manual frame/size limits have been reached.
  Capture and input commands remain asynchronous
  and run off the UI thread.
- webrtc-rs 0.17 implements TURN/UDP gathering. A private loopback transport adapter supplies TURN/TCP and TLS
  framing without changing its authentication/allocation logic. TLS validates normal trust roots and the server
  name; there is no production option to disable verification. The adapter lifetime belongs to the stream.

## Controls and lifecycle

PC Web viewers use the physical mouse directly: hover, left/right/middle clicks, double clicks, dragging
and wheel input map to the fitted video rectangle. Letterbox clicks are ignored. The virtual mouse panel
is reserved for touch devices. Clicking the desktop focuses keyboard input; physical key down/up events
support editing keys, modifiers and shortcuts, while local IME composition commits Unicode text once.
Local forms and toolbar controls keep their normal keyboard behavior. Blur, disconnect and session expiry
release remotely held keys and buttons. Browser/OS-reserved shortcuts may remain local.

On native and touch Web viewers, holding the mouse panel's center wheel shows a compact cross-shaped
scroll control. Without lifting, drag up/down or left/right to scroll the content under the remote cursor;
holding farther from the starting point increases the speed. Releasing stops scrolling and immediately
restores the mouse panel. A tap does not leave the cross open or send a remote click. The cross stays within
the viewport. Interrupted gestures, backgrounding, mode changes and disconnects stop scrolling and dismiss it.
Horizontal scrolling requires an updated Windows host; older hosts retain vertical scrolling with an update hint.

The desktop viewer uses the system clipboard for text, PNG images and files in both directions.
Copy locally, then press Ctrl+V (or Shift+Insert) over the remote desktop to transfer and paste.
Ctrl+C/Ctrl+X in the remote desktop copies the selection into the local system clipboard; files can then
be pasted directly into Explorer without downloading or opening the Clipboard panel. File entries survive
closing the viewer. Clipboard I/O runs on blocking workers, and gestures queue in order so an immediate
paste waits for an earlier copy to finish. Queued work is discarded when the viewer disconnects or closes.

The Web clipboard supports bidirectional text and PNG images, plus copying files into the remote Windows
clipboard and downloading remote clipboard files. Ctrl+C/Ctrl+X copy the remote selection; Ctrl+V consumes
the browser's trusted paste event, including available files. The **Clipboard** panel also offers local
paste, remote clipboard retrieval, a file picker, explicit copy retry and file downloads. Browser APIs
cannot create arbitrary Explorer/Finder file clipboard entries; multiple remote files have individual
download buttons. Folders must be zipped first. A copied image file can be sent as a file with the picker.
Clipboard access requires the browser's normal permissions; denied writes retain received content for a
user-initiated retry. Content is transferred only after a paste/copy action, with no background clipboard polling.

Clipboard transfers use the authenticated desktop's ordered, encrypted control channel in acknowledged
32 KiB chunks, capped at 64 MiB and 32 files. Native and WebView capture paths share the same clipboard
service, session checks, validation and input ordering. Files use validated basenames inside a fresh
application-owned temporary directory; source paths never cross the connection. Temporary files remain
available for pasting after disconnect and expire after 24 hours, cleaned on a subsequent file transfer.
Both the Web frontend and Windows host app must be updated. Capability negotiation keeps older hosts
connected and explains which update is needed instead of sending unsupported keyboard/clipboard messages.

The touch viewer draws its own pointer immediately; all Windows capture paths exclude the host cursor.
The compact floating mouse follows that pointer and can extend into letterbox space around the video.
The 18 × 24 pointer stays at the upper-left of the 120 × 136 mouse panel, including over black letterboxing.
Movement stays at normal speed until the panel reaches the right or bottom viewer edge.
At the screen boundary, the complete panel stays visible with an 8 px inset while the desktop continues to pan.
The bottom black margin opens at twice the swipe speed; the right margin opens at swipe speed.
The panel can extend outside the video into the black margin, but cannot leave the fitted viewer.
Panning the shared video rectangle preserves the cursor-to-panel offset and the actual remote click target.
Reversing the gesture moves the panel immediately at 1:1 finger distance while closing the corresponding margin
at the same speed. Changing direction again keeps 1:1 movement until the panel reaches the screen edge.
Local panning advances on every input event, independently of React rendering or network flushing;
pointer-only moves leave the video and surrounding viewer UI unchanged. Idle collapse preserves the translation,
and expanding an edge-panned icon makes room for the full panel. The translation resets on rotation
or a switch to direct touch. Cursor placement and video rendering share the translated rectangle. The native cursor image
has explicit layout dimensions so its 3x bitmap cannot enlarge it. Motion and direct touches use the displayed video rectangle,
including the current zoom and translation.
The mouse provides left/right buttons, scroll arrows, a relative touchpad and a handle that moves the pointer and panel together.
Long-press the left button to latch a drag and press it again to release. Tapping the touchpad clicks.
After ten idle seconds the panel collapses to a round mouse icon; tapping it reopens the controls.
Held fingers, buttons and latched drags prevent automatic collapse.
One toolbar button shows the current mouse/direct-touch mode; tapping it switches to the other mode.
Direct touches click or drag at the touched video position;
touches that start in the letterbox are ignored. Switching modes releases held buttons.
The keyboard sends Unicode text and common keys; Windows shortcuts show the desktop and Task View.
The input panel stays above the software keyboard, uses a compact landscape layout and hides stats while open.
Web follows visual-viewport keyboard resizing; dismissing input restores the user's stats visibility choice.
Native disables keyboard padding when both input panels are closed, so Android navigation-bar insets cannot
leave a gap below the desktop after dismissing the keyboard.
Native rotation and Web responsive layouts retain the same controls. Display panels stay within 400 px.

Landscape fits the desktop to the full viewer height without stretching. Wider desktops can extend past the sides;
portrait fits the complete picture. The native landscape modal hides the status bar and removes top/bottom safe-area
padding while retaining side insets for cutouts. The Web viewer removes its vertical safe-area padding in landscape.
Outside the mouse panel, pinch with two fingers to zoom from the fitted size up to 4×, and move both fingers to pan.
The pinch follows its center without moving the remote mouse. After one finger lifts, the remaining finger is ignored
until the gesture ends. While magnified, only two-finger gestures move the picture; mouse input and panel collapse
cannot recenter it. Mouse controls keep their cursor offset even outside the magnified view;
two-finger panning can bring them back into view.
Shrinking to the fitted size restores mouse edge assistance. Rotation and closing reset zoom.
The native video surface retains its fitted layout size and applies translation/scale together as a transform,
so Android does not resize the underlying surface on each pinch event or show a late jump after release.

The top-left overlay shows elapsed connection time, the selected transport/direct-or-relay route, received FPS and Mbps,
round-trip latency, average decode time per frame, interval packet loss, resolution and local network type when available.
Values come from receiver [WebRTC statistics](https://www.w3.org/TR/webrtc-stats/), sampled once per second without
overlapping reads. Configured sender limits are not displayed as measured rates. Missing metrics use “—”; browsers may
withhold the local network type. The close button on the overlay's right hides only the statistics. Display settings can
show them again, without reconnecting the desktop.

A transient chat-connection interruption keeps the viewer open and preserves its orientation. Desktop media has
its own connection state and retry action; chat reconnection does not dismiss the viewer or restore portrait.

Only one remote desktop may own a host at a time. Control queues are bounded and coalesce pointer motion while
preserving button ordering. Closing the viewer, hiding the app/page, losing its chat session or missing the
control heartbeat stops capture. A separate native 15-second lease releases mouse buttons if the desktop
WebView disappears. Input validation rejects nonfinite/out-of-range coordinates and oversized text/wheel data.
The current implementation does not elevate input into protected Windows prompts or change the host's display resolution.

## Verification

The [damage-aware capture validation](remote-desktop-damage-validation-20260927.md) records controlled
payload comparisons and the limits of this optimization.

The [1.6.2 physical-device investigation](remote-desktop-investigation-20260926.md) records measured
capture/playback limits, the missing media-relay path and references to mature open-source implementations.

```powershell
npx vitest run src/remoteDesktop src/remoteChat/guiTools.test.ts src/remoteChat/hostRecovery.test.ts
# Run the command above from apps/desktop.
npm run test:remote-desktop:e2e -w @codex-switch/web
npm run check -w @codex-switch/native
npm run export:android -w @codex-switch/native
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --tests -- -D warnings
# Build the native helper and compare controlled idle/local/full-motion scenes through a real H.264 decoder:
node scripts/test-desktop-damage.mjs
# Interactive Windows video + WASAPI sound -> native H.264/Opus/WebRTC -> real Edge decoders (opt-in):
$env:CSW_NATIVE_TEST_REQUIRE_DAMAGE = '1'
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests native_capture_reaches_a_real_browser_decoder -- --ignored --nocapture
Remove-Item Env:CSW_NATIVE_TEST_REQUIRE_DAMAGE
```

To require the DXGI/H.265 path in the same real WebRTC test, use a receiver that reports hardware HEVC:

```powershell
$env:CSW_NATIVE_TEST_REQUIRE_DXGI = '1'
$env:CSW_NATIVE_TEST_CODEC = 'h265'
$env:CSW_NATIVE_TEST_BROWSER = 'chrome'
$env:CSW_NATIVE_TEST_MOVING = '1'
$env:CSW_NATIVE_TEST_MIN_FPS = '50'
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests `
  native_capture_reaches_a_real_browser_decoder -- --ignored --nocapture
Remove-Item Env:CSW_NATIVE_TEST_REQUIRE_DXGI, Env:CSW_NATIVE_TEST_CODEC, Env:CSW_NATIVE_TEST_BROWSER
Remove-Item Env:CSW_NATIVE_TEST_MOVING, Env:CSW_NATIVE_TEST_MIN_FPS
```

The 2026-10-09 ZH development test decoded 299 frames in five seconds (59.8 FPS) at 1920×1080 through
DXGI → NVENC H.265 → native WebRTC → Chrome, with system audio. This is a local browser test, not a
measurement of WAN latency or the other PC's installed WebView. Chrome reported HEVC capability on this
machine; Edge did not, so it must retain H.264. Secure desktop/UAC and rotated-monitor validation still
require corresponding Windows sessions/displays; do not treat browser layout fixtures as those device tests.

To exercise a particular Windows display, set `CSW_NATIVE_TEST_DISPLAY` to its device name (for example
`\\.\DISPLAY2`) before the native decoder test. The test rejects a missing requested display and checks the
decoded aspect ratio. The ignored `captures_each_connected_display_with_its_own_aspect_ratio` test checks
the JPEG compatibility path on every connected display. On 2026-09-28, both tests passed with a 2560 × 1440
primary display and a 2560 × 1600 secondary display using different Windows scaling settings. Native WebRTC
delivered 1920 × 1080 and 1920 × 1200 video respectively, with decoded system sound on both connections.
Browser regression tests cover monitor switching in portrait, landscape and desktop layouts; native component
tests cover selected/disabled controls. These checks do not replace Android/iOS physical-device validation.

With isolated TURN credentials in `DESKTOP_UPGRADE_TEST_ICE`, `remote-desktop-standby.pw.ts` and
`remote-desktop-upgrade.pw.ts` verify standby creation/repair, paused backup media, retained relay fallback and
capture continuity. The native decoder test also covers relay → direct → relay → direct when
`CSW_NATIVE_TEST_ICE`, `CSW_NATIVE_TEST_UPGRADE=1` and `CSW_NATIVE_TEST_STANDBY=1` are set.
Both upgrade tests delay the new direct channel's first heartbeat to reproduce an early standby heartbeat.
Rust regression tests additionally verify that early standby activation cannot cancel capture or authorize a peer.

The native test renders a quiet 440 Hz tone and checks decoded audio samples alongside video frames. It needs
an active default Windows output device. It also checks Opus packet/sample counts; waveform analysis avoids
depending on the optional audio-level RTP extension. iOS audio route behavior still needs a physical device check.

The browser fixture substitutes only Tauri capture/input IPC; it exercises the production sender, receiver,
WebRTC connection and control channel. Screenshots cover portrait, landscape and desktop layouts.
The Go media-relay integration suite also forces relay candidates through real coturn over UDP, TCP and TLS,
checks metered bytes, and can include the native Windows sender. Its temporary CA is accepted only in the Rust
test build. Decoder frame counts are throughput measurements; a moving source is required to judge motion quality.
`apps/desktop/e2e/android-remote-desktop.mjs` drives the installed release APK on a disposable emulator.
Start `mobile-fixture.mjs` with `CHAT_TEST_REMOTE_DESKTOP=1`, `CHAT_TEST_API_PORT=1498` and
`CHAT_TEST_UI_PORT=1486`. Use `ANDROID_CHAT_DISPOSABLE=1`, `ANDROID_SERIAL` pointing at that disposable emulator,
`CHAT_TEST_API_PORT=1498` and `ANDROID_CHAT_OUTPUT=remote-desktop-android` when running the Android test.
The test installs the APK and clears only its disposable emulator's app data. Never point it at a physical phone
or an emulator containing user data.
