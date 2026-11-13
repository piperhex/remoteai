# Built-in browser inspector

On Windows, **Inspect** in a built-in browser page opens the real WebView2 developer tools beside
that page. The default placement is on the right. The toolbar switches to the bottom or a separate
window, or closes the inspector. Drag the divider to resize an embedded inspector. The divider
also supports arrow keys, Home/End, and double-click to reset its size.

This applies to normal browser tabs and conversation-owned native browser previews, including
desktop local and remote workspaces. Switching placement preserves the page and inspector session.
Inactive tabs and application overlays hide the native inspector. Closing a tab closes its inspector.
Web pages use their host browser's developer tools; macOS and Linux retain their system inspectors.

## Windows integration

WebView2 does not expose a supported docking API. The integration adopts the uniquely discovered
DevTools HWND from the inspected tab's browser process. A process check and per-window property
marker prevent touching recycled handles or adopting another tab's inspector. Window discovery,
reparenting and polling run outside the Tauri UI thread. No production debugging port is enabled.
If discovery fails after a WebView2 update, the system inspector remains available separately.

The native context menu keeps WebView2's original command IDs, including Inspect's selected node.
The same ContextMenuRequested handler handles native mouse, keyboard and touch context requests.
A COM deferral lets the original callback return before the Windows menu enters its message loop.

## Verification

- Run the `provider_browser::` Rust tests and the desktop `inspectorSession.test.ts` suite.
- Build desktop and Web, and run the shared boundary and i18n checks.
- Run Web's `scripts/playwright.browser-inspector.config.ts` using `scripts/run.mjs playwright`.
- Start the desktop browser harness with `scripts/vite.browser-bookmarks.config.ts` on port 1562.
  Pass a compiled Rust test executable to `scripts/verify-browser-inspector-native.mjs start`.
  Use its `open local`, `open remote --dark`, `right`, `bottom`, `window`, `resize`, `tabs` and `close`
  actions. Choose the native Inspect menu item manually or through the desktop testing tools.
- For conversation-owned tabs, serve the harness on port 1552 and add `--managed` to `start` and
  `open local`. Both fixtures use an isolated application identifier and test-only debugging port.
- Inspect running-window screenshots, selected DOM nodes, actual divider drags and retained input.
  Check narrow windows at default and enlarged font settings. Verify touch long-press on Windows
  touch hardware: protocol-emulated touches do not validate the operating system's hold gesture.
