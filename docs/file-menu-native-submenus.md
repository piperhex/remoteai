# Native file menu submenus

Ant Design portals its nested menus next to the root dropdown using
`ant-dropdown-menu-submenu-popup` (or `ant-menu-submenu-popup` for standalone menus).
The native overlay must include these surfaces in its visible and input regions.
Tracking only `ant-dropdown` leaves the submenu in the DOM but clips it out of the
Windows window. Hidden or removed submenus must release their regions as before.

## Regression checks

Run the focused unit tests from `apps/desktop`:

```powershell
npx vitest run --config scripts/vitest.config.ts src/pages/providers/browserNativePopup.test.ts src/pages/codexGui/FileMenu.test.tsx
```

For Windows integration checks, start the fixture server from `apps/desktop`:

```powershell
npx vite --config scripts/vite.website-tabs.config.ts --host 127.0.0.1 --port 1552 --strictPort
```

Then pass a desktop Rust test executable containing the ignored
`provider_browser::automation::tests::opens_conversation_browser` test:

```powershell
node scripts/test-file-menu-native.mjs <native-test-executable>
```

The runner uses isolated native fixture data and ports 9361/9362. File actions are
recorded without opening applications or changing files. It checks the local
installer preview card, remote file actions, and the web fallback at wide/default
and narrow/enlarged settings. It exercises hover, submenu selection, click, Escape,
right-click and touch long-press. Remote and web installer cards retain download-only
actions. A Win32 probe checks the actual clipping region against both menus, since
DOM visibility alone cannot detect this regression.

Screenshots and native logs are saved under `.codex-tmp/file-menu-overlay/`.
`--keep-open` retains the native fixture for additional desktop screenshots.
