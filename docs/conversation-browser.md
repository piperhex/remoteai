# Conversation browser

Conversation previews share `BrowserContents` with the Provider browser. Different links create separate
tabs; revisiting the same link selects its tab. Overflow uses the project tab behavior: earlier tabs
slide out to the left, the active tab stays visible, and an ellipsis menu lists hidden tabs. Page state survives switching tabs, opening a file,
minimizing the sidebar and expanding the preview. Provider credentials and headers are not supplied to
conversation tabs.

The bundled Chrome skill and MCP instructions prefer the Chrome assistant. They direct models to the
built-in browser when it is explicitly requested, missing, disconnected, paused, disabled or otherwise
unavailable. Paused Chrome profiles remain paused. Switching browsers does not transfer Chrome login
state or authorize replaying uncertain submissions. An explicit website permission denial still applies.

## Model tools

The authenticated `codex_gui` MCP server advertises:

- `gui_browser_open({ threadId, requestId, url })`: open an HTTP(S) page and reveal the preview. Repeating
  the same request ID and original URL returns the same tab, even after it navigates.
- `gui_browser_use({ threadId, tabId?, command })`: list tabs, snapshot, screenshot, navigate, back,
  forward, reload, close, click, type, select, scroll or key. `tabId` is required except for listing.

Read a snapshot before element actions and use its exact references. A later snapshot invalidates old
references; navigation and detached elements also invalidate them. `type` replaces field text. Password
values are excluded from snapshots. Screenshots are MCP image blocks. `dispatched` acknowledges input
delivery only; models must inspect the result. No arbitrary JavaScript tool is exposed.

For example, after opening a page, pass `{"action":"snapshot"}`. Use the returned input reference in
`{"action":"type","reference":"<snapshot-reference>","text":"Example"}`, then inspect a fresh snapshot.

Tabs belong to their conversation and survive switching conversations. Closing a tab synchronizes the
sidebar through GUI events. Browser actions are serialized per tab; creation is deduplicated and limited
to 32 tabs per host. Remote pages have no application IPC capability and cannot navigate to the application
origin or local files. Downloads are disabled, following the existing Provider browser policy.

## Local and remote rendering

Local desktop previews place the native WebView in the shared browser UI. Remote desktop and web
clients send operations through the selected computer's authenticated chat connection and display
single-flight snapshots of that same native page. They do not load a separate copy of an AI-controlled page.
The mouse pointer and click feedback reuse the Chrome extension's pointer implementation; typing also
highlights the field.

Windows uses WebView2 for screenshots and native key input. Hidden model tabs remain rendered outside
the main window's content bounds so remote preview capture continues. Other platforms support DOM
operations and a bounded DOM keyboard fallback; screenshots/remote image streaming are currently
unsupported there, and unsupported operations return an error. The host requires a main application
WebView. Ordinary manually opened web previews retain the existing sandboxed iframe adaptation and
its website embedding restrictions.

## Verification

Use bundled Chromium through `scripts/test-browser.mjs` for browser tests:

```powershell
cd apps/desktop
npx playwright test --config playwright.website-tabs.config.ts
npx playwright test --config playwright.provider-market.config.ts provider-browser.pw.ts
```

The website suite covers local, remote and web layouts at 1440/light and 1024/dark, preserving tab contents,
closing/adding tabs, refreshing, invalid addresses, expansion and conversation changes. Output is in
`.codex-tmp/website-tabs`.

The Windows native integration test uses its own test window and WebView profile. Start the fixture
server (`node e2e/website-tabs-server.mjs`) and Vite on port 1552 with `vite.website-tabs.config.ts`, then run
the ignored Rust test `provider_browser::automation::tests::opens_conversation_browser`. Run
`node e2e/website-tabs-native.mjs` against its test-only CDP port 9333. For remote image verification,
start `node e2e/website-tabs-bridge.mjs`, then run `node e2e/website-tabs-remote-native.mjs`.
These scripts exercise actual native pages and write screenshots to `.codex-tmp/website-tabs-native`.
Stop the test window, bridge and fixture servers afterward.
