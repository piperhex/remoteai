# Native browser popups on Windows

Browser settings, bookmark menus/dialogs, address suggestions and password suggestions use an owned
Win32 popup containing a WebView2 controller. The underlying browser stays visible and continues
rendering; these menus no longer require its screenshot preview. Desktop local and remote navigation,
including the conversation browser sidebar, share the same components. Web keeps ordinary DOM portals.
Other desktop platforms and Windows initialization failures retain the existing preview fallback.
Unrelated application dialogs outside the browser provider still use the existing native-surface policy.

The trusted main renderer requests a random opening ticket and opens its same-origin `about:blank`
document. `NewWindowRequested` attaches a controller created from the main controller's environment,
which is required for a usable opener relationship. React portals preserve the owner's contexts,
callbacks and stores. The popup has no injected Tauri bridge and needs no additional capability label.
Native commands accept only the main renderer. Popup navigation and nested windows are restricted.

The HWND is owned by the application and is never globally topmost. Its input region is the union of
visible popup rectangles, including shadows; other pixels continue delivering input to the page.
`WS_EX_NOREDIRECTIONBITMAP` preserves transparent composition through move/resize. Showing the window
does not activate it. Explicit focus into a popup is handed to WebView2 after its region is placed;
password suggestions do not take focus merely because a form field becomes active. Closing the last
popup returns native keyboard focus to the previous control in the owner window.

Clipping regions use untransformed layout bounds. Ant Design's opening animation briefly scales a
menu to zero and then grows it without DOM mutations on every frame. Using transformed bounds here
clips icons and menu edges until the animation finishes. Offscreen alignment preparation is excluded;
the full menu region stays available throughout the opening and closing animations.

Stylesheets, theme attributes and font variables are mirrored into the portal document. Its element
factories create nodes in React's realm before DOM adoption, preserving the `instanceof` assumptions
in React and rc-trigger. Keep this compatibility behavior scoped to this trusted document.
Native objects stay on the UI apartment; async commands await UI callbacks without blocking it.
Page navigation, owner destruction and failed initialization dispose the popup and its listeners.

## Verification

Start desktop Vite on port 1552, then compile the ignored native fixture:

```powershell
$env:CARGO_PROFILE_DEV_DEBUG = '0'
$env:CARGO_PROFILE_TEST_DEBUG = '0'
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests --no-run
node apps/desktop/scripts/test-browser-native-popups.mjs <path-to-codex_switch_lib_tests.exe>
```

The runner uses an isolated test profile, a local animated page on port 18316, and test-only credentials.
It applies `scripts/test-browser.mjs` arguments, uses CDP ports 9343/9344 and closes its own process/server.
`--keep-open` retains the fixture for window-level inspection. The previous
`test-browser-overlays-native.mjs` entry point delegates to this runner.

Checks cover local/remote, light 14 px/wide and dark 20 px/narrow, nested settings, history inputs,
bookmark editing/right-click/long-press, address navigation and password typing/fill/Escape/keyboard
selection. They assert advancing animation frames, visible page state, unchanged page identity and
preserved input while menus are open. Conversation browser settings and bookmarks are checked too.
Screenshots go to `.codex-tmp/browser-native-popups/`.

The runner also samples the real Win32 region during each settings-menu opening using
`browser-popup-region-probe.ps1`. It checks that every visible sample covers the final menu bounds
and that an opening does not hide/reappear. The probe opts into per-monitor DPI coordinates so its
native measurements can be compared with CSS coordinates scaled by the popup's device pixel ratio.

Also verify actual OS keyboard focus, window movement and resizing using the running fixture.
A CDP key directed at a popup can pass even when Windows still sends real keyboard input to the page.
Capture the desktop composition cropped to the fixture's window bounds: a window-only capture can
omit owned popups. Do not combine separately rendered images as evidence of native composition.

Run the popup/overlay/input Vitest tests, Rust tests/formatting, desktop production build, shared
boundary and i18n checks. Export shared dependencies and run Web checks and browser bookmark tests.
