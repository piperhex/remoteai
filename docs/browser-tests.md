# Browser tests

Install the browsers matching the repository's Playwright version from the repository root:

```sh
npx playwright install chromium
```

Build and browser-test configurations live in each application's `scripts/` directory. Prefer its
`npm run dev`, `npm run build`, `npm test` and `npm run test:e2e` commands where available. When invoking
a runner directly, pass the configuration explicitly, for example from `apps/desktop`:

```powershell
npx playwright test --config scripts/playwright.chat.config.ts
npx vitest run --config scripts/vitest.config.ts
```

Desktop, web, website, and native-test browser fixtures default to Playwright's bundled Chromium.
Headless runs without a `channel` use the bundled headless shell. Headed and extension tests use
the bundled full browser. Missing browser binaries are an installation error; do not fall back
to a system browser. WebKit projects and tests attached to Android Chrome keep their own browsers.

## Windows account lockouts

Repeated system Edge launches with fresh profiles produced local Windows logon failures (Security
event 4625, substatus `0xc000006a`) and locked the signed-in account (event 4740). One triggering
process was traced directly to a Playwright SSH test. Bundled Chromium 153's full-browser mode
also reproduced a failure; switching away from Edge alone is insufficient. This resembles the Chromium Windows
password-status regression tracked in [Chromium issue 562403601](https://issues.chromium.org/issues/562403601).
Do not disable Windows account-lockout protection or reset the user's password to work around it.

Use `testBrowserChannel` from `scripts/test-browser.mjs` for environment-based channel overrides.
It rejects system Chrome/Edge channels on Windows before a browser is started. Leave these
variables unset to use the bundled headless shell; `chromium` selects the bundled full browser:

- `CHAT_TEST_BROWSER`: desktop and web tests, including the browser serving native chat fixtures.
- `WEBSITE_TEST_BROWSER`: website tests.
- `CSW_NATIVE_TEST_BROWSER`: native remote-desktop stream tests.
- `PLAYWRIGHT_CHANNEL`: pet renderer tests.

Extension tests use `testBrowserExecutable` for `CSW_CHROME_TEST_BROWSER`. On Windows, only the
bundled Chromium executable is accepted. Other platforms retain explicit system-browser overrides.
These checks do not change browser preferences, installed system browsers, or Windows policy.

All Chromium Playwright configurations use `testBrowserLaunchOptions`. On Windows it disables
`AutofillAiWalletPrivatePasses`, the password-probe workaround reported in
[Microsoft's issue tracker](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5722).
Raw extension-test launches use `testBrowserArguments` for the same workaround. WebKit projects
must not inherit these Chromium arguments.

The launch helper preserves Playwright 1.63.0's entire default disabled-feature list, merges
caller flags (including WebRTC flags), and replaces only that exact default feature argument.
It stops before launching if Playwright changes version or all default arguments are discarded.
When upgrading Playwright, review its default flags and repeat Windows authentication-log checks
before updating the recorded version and feature list. Do not bypass the guard to make a test run.

Validate the override guards with:

```sh
node --test scripts/test-browser.test.mjs
```

After changing browser selection on Windows, check Security events 4625 and 4740 around an actual
test run and correlate process IDs when other tasks are running. Allow at least 30 seconds after
browser shutdown for Security events to become visible. A passing page assertion alone
does not show that the browser avoided Windows authentication attempts. An already-running test
process retains its loaded configuration; the new selection takes effect on its next invocation.
