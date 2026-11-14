# Navigation browser home

The Admin **Browser home** page accepts a ZIP of a static site, including a compiled React `dist`.
The archive may contain `index.html` at its root or inside one enclosing directory. Include every
local script, stylesheet, font and image. Uploading preserves the current enabled/disabled setting;
enable the home after previewing it. Restoring the default disables the custom page without deleting it.

Only the desktop navigation browser uses this home. Conversation previews, Provider browsers and
mobile Web layouts retain their existing behavior. Hash routing is recommended for static applications.
Server-side rendering and build commands are not executed. Uploaded scripts run in an isolated frame.

Clients check `/browser-home/current` only when the navigation browser becomes active. The server
returns the complete resource package's MD5; unchanged packages are reused. An update is bounded,
checksum-verified and cached before the view changes. While updating or offline, the previous complete
home remains available. A client with no cache keeps the existing blank page. There is no periodic check.

Desktop clients persist packages in the application cache and serve them through a loopback resource
server. Hosted desktop mode serves the same resources through its existing HTTP host. Web desktop stores
validated packages in CacheStorage and embeds static resources in an isolated document; import maps
preserve static, cyclic and lazy module imports. Browser storage remains subject to browser eviction.

Archives are limited to 20 MiB compressed, 100 MiB expanded, 10 MiB per file and 2,000 entries.
Paths, duplicate names, unsupported file types and symlinks are rejected. The final package is limited
to 160 MiB. MD5 is a cache validator; administration still requires the existing authentication and
the `admin.browser-home.read` / `admin.browser-home.manage` permissions.

## Verification

The backend suite includes archive, authorization, routing and PostgreSQL transaction tests. Set
`BROWSER_HOME_TEST_DATABASE_URL` to a disposable loopback PostgreSQL database named `browser_home`
to run persistence tests. The Playwright fixture uses isolated schemas in that same disposable database.

Run from `apps/desktop`:

```powershell
node ../../node_modules/@playwright/test/cli.js test --config scripts/playwright.browser-home.config.ts
```

The suite starts the real backend home handlers, Admin UI, desktop layout fixtures, Web and an explicit
Rust cache service fixture. It checks upload/preview/disable, MD5 reuse, update fallback, offline reload,
first-use blank state, module imports, navigation and scope, plus local/remote/Web screenshots.
The Rust fixture is ignored in ordinary unit-test runs and requires `BROWSER_HOME_UI_FIXTURE=1`.
