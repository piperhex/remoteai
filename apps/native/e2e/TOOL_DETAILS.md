# Tool details on a physical Android device

`ToolDetailsFixture.tsx` opens the production `ChatToolDetails` with the reported
two-part computer-use result. It also provides literal text, paginated output,
light/dark themes and a clipboard readback. Its separate application ID preserves
the installed app and its data.

Build from `apps/native/android` with the Android SDK, Java 17 and Rust tools on
the environment paths. Set `NODE_ENV=production` and `NODE_PATH` to the absolute
`apps/native/node_modules` directory, then run:

```text
gradlew.bat assembleRelease -I ../e2e/tool-details.init.gradle -PreactNativeArchitectures=arm64-v8a
```

From the repository root, set `ANDROID_SERIAL` to the connected phone and run:

```text
node apps/native/e2e/tool-details-test.mjs
```

The runner checks immediately visible structured data, the bottom raw-data copy entry,
complete clipboard contents, input sheets, back/close, both themes, system font scales
1.0 and 1.3, literal output and full copy from the last page. It restores the original
font scale on exit. Screenshots and measurements go to
`.codex-tmp/tool-details/`.

Web coverage uses the same reported payload. From `apps/web` run:

```text
npx playwright test --config playwright.chat.config.ts tool-details.pw.ts
```

This covers 390px mobile and 1280px desktop layouts, direct structured results, raw copy,
input disclosures, literal output and pagination.
