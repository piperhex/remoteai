# Windows browser context menu coordinates

WebView2 `ContextMenuRequested.Location` is relative to the WebView's upper-left corner in DIPs.
The native popup requires screen pixels. Convert the event with the controller's current
`RasterizationScale`, add its bounds in the parent client area, then call `ClientToScreen` on
`ParentWindow`. Wry uses raw-pixel bounds; the conversion also respects WebView2's logical bounds mode.
Page zoom is already reflected in the event location and must not be applied again.

The previous path added the unscaled event to physical bounds. At 125% scaling, a request at
`(280, 200)` appeared approximately `(70, 50)` physical pixels above and left of its intended anchor.
The error grew with distance from the WebView origin. Windows can additionally flip a menu at a
screen edge; that behavior is independent of the application's window bounds.

Keep the event's anchor rather than reading the OS cursor. Keyboard invocation, remote/programmatic
input and touch-and-hold can request a menu away from the cursor. Windows may adjust a touch anchor
to avoid covering the finger. The existing deferral and original menu command IDs remain intact.

Reference: [Microsoft WebView2 sample's native menu conversion](https://github.com/MicrosoftEdge/WebView2Samples/blob/main/SampleApps/WebView2APISample/SettingsComponent.cpp)
and [WebView2 context menu API](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/context-menus).

## Entry points

Desktop local and remote browser pages both use `ProviderBrowserSurface` and the local native
controller. Their page input is delivered directly to that controller; there is no additional
remote-desktop coordinate transform in this menu path. The conversation browser installs the same
inspector menu handler. Web uses `BrowserFrame` with the host browser's iframe/context menu and does
not invoke this Win32 conversion. Do not introduce a second menu or duplicate scaling in shared UI.

## Reproduction and verification

Start desktop Vite on port 1552, compile the ignored native fixture, and copy its executable so
running tests do not lock Cargo's link output:

```powershell
$env:CARGO_PROFILE_DEV_DEBUG = '0'
$env:CARGO_PROFILE_TEST_DEBUG = '0'
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests --no-run
node apps/desktop/scripts/test-browser-context-menu.mjs <copied-test-executable>
```

The runner uses a dedicated application identity, loopback page on 18326 and CDP ports 9363/9364.
It preserves the repository's WebView2 test browser arguments. Test-only IPC adjusts the native
controller's rasterization and page zoom without changing Windows display settings or user profiles.
The native probe operates only on the fixture PID, temporarily raises the fixture and its native
menu, captures the actual desktop composition, and measures the Win32 menu bounds. Each run closes
its process, CDP clients and local server. `--keep-open` retains a successful fixture for inspection.
`--before` captures an older executable without requiring the new test-only IPC command.

The matrix covers local/remote, 1200x800 and 685x521 logical windows, rasterization scales
1/1.25/1.5/2, page zoom 0.8/1/1.5, right-click and native Windows touch-and-hold. The nonselectable
test page ensures both gestures address page content rather than opening a text-selection menu.
Touch uses `InitializeTouchInjection`/`InjectTouchInput` with a 1.2-second hold and continuing frames.
It checks the menu's original action labels match and that all menus dismiss before the next case.
Measurements and labeled screenshots are written to `.codex-tmp/browser-context-menu/`.
Integer DOM coordinates and WebView2 POINT values have separate rounding steps; assertions allow
only their combined quantization error. Run the OS at a normal display scale; test-specific controller
scales do not constitute physical multi-monitor migration or physical touchscreen hardware testing.

Also run Rust formatting, provider-browser tests, the desktop production build, and Web's
`scripts/playwright.browser-inspector.config.ts` regression. Web captures go to
`.codex-tmp/browser-inspector-web/`. Only fixture copy and test code contain test-page text.
