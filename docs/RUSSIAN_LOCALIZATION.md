# Russian localization

Translation resources now live in the private workspace package [`@remoteai/i18n`](../packages/i18n/README.md).
Client resources live in `packages/i18n/src/catalogs/client`, Coze resources in its submodule localization package,
and desktop semantic resources in `src/catalogs/desktop`. All use stable semantic keys. Run
`npm run generate:i18n` and `npm run check:i18n` after edits. Language metadata, application release policies and the generated Rust acceptance table are documented in that README.

Desktop, web, Android and iOS support Chinese, English and Russian (Русский). Every client opens in Chinese on a Chinese system or browser locale and in English on any other locale, Russian locales included; Russian is chosen in the language selector (desktop and web settings, the native login screen and native Settings). Native apps save the choice in secure storage and restore it before showing the app. A saved choice always takes precedence.

Coverage includes desktop navigation, accounts, providers, token usage, settings, themes, plugins, conversation controls, permissions, scheduled tasks, terminal actions, configuration labels, tray actions and the user agreement. Native coverage includes login, accounts, devices, chat and its tools, remote desktop controls, downloads, 2FA, settings and updates. Web uses the shared interface dictionaries and matching component-library locales, with narrow mobile and desktop layouts checked. Desktop also covers the built-in plugin cards (Chrome browser assistant, Computer Use, remote command), remote desktop and Mac permission settings, Codex GUI errors, the quick menu and HTTP status descriptions. `README_RU.md` is the Russian README.

Desktop backend messages keep their Chinese source text and are translated where they are displayed. Surfaces rendered by Rust (completion notifications, save dialogs, sign-in window titles, the OAuth callback page, local proxy errors and the tray menu) use Russian only when Russian is the saved interface language and otherwise keep their previous text. The Chrome browser assistant extension follows the Chrome UI language. macOS and iOS permission prompts follow the system language.

Conversation messages, code, file paths, model identifiers, permissions and request values remain unchanged. Language changes update mounted views without remounting chat or reconnecting it. Command search retains its original aliases. Translation dictionaries are bundled with the application; no external translation service is used at runtime. The standalone admin interface and the website are outside this change.

The review of `bbbc02617b7c4bf8c7cbfcea58ffa1bfe579ad62` also fixes inherited-property dictionary lookups, repeated interpolation of inserted values, stale memoized chat/diff labels, the Russian settings badge, image-editor document language and language broadcasts when browser storage is unavailable. Desktop language persistence runs off the Windows UI thread and writes only `interface-language.json`, so it cannot overwrite concurrent account/proxy settings. Existing `settings.json` language values remain the fallback until an explicit save.

## Maintenance

- Desktop semantic keys: `packages/i18n/src/catalogs/desktop/{zh,en,ru}/`.
- Shared GUI/web/native resources: `packages/i18n/src/catalogs/client/{zh,en,ru}/`.
- Add semantic keys with a feature context and provide all released translations. The generator validates
  placeholders and derives key/parameter types; do not use Chinese source text as a lookup key.
- Service errors: `formatRemoteError(language, error)` and `remoteErrorText(error)` in
  `shared/localization/errors.ts` decode existing external text at display time. They accept stable
  `{ code, params, message? }` errors too. New UI errors carry semantic keys; preserve external wire strings
  for classifiers. Unknown error text is displayed unchanged. Normal translation does not decode source text.
- Never translate values that other code matches by equality or pattern, such as shared/remote-chat/connectionErrors.ts, shared/remote-desktop/diagnostics.ts and apps/desktop/src/utils/usageErrors.ts.
- Host messages sent to remote clients come in two kinds. Fixed error sources stay Chinese on the wire and clients translate them when displayed: Codex GUI command errors from Rust, the `operationError` fallback in apps/desktop/src/remoteChat/operations.ts and fixed validator messages such as `附件名称无效，请重新选择。` or `图片较大，请减少图片后再发送。`. Messages and details that contain values are formatted in the host's interface language, because the remote client normally belongs to the same user. These are the shared validator messages with limits when the host checks client data (`checkFileUploadSize` and the total-size check in `validateUploadedFiles` via apps/desktop/src/remoteChat/queue.ts and operations.ts, the image count in `validateChatImages`, the frame-rate range in `validateSettings` via remoteDesktop/host.ts), the account picker details from remoteChat/guiAccounts.ts (plan, remaining limits and provider balances from guiAccountBalances.ts) and the unknown-account label in remoteChat/tokenSummary.ts. remoteChat/connectionDetails.ts also names unnamed devices in the host language, for the host's own list of connected devices. A client set to another language shows these strings in the host's language.
- Rust: `crate::storage::interface_language()` returns `Zh`, `En` or `Ru` and is updated by `read_app_settings` and `save_app_language`; only an explicit `ru` selects Russian. Russian tables: src-tauri/src/storage/interface_copy.rs (notifications, dialogs, window titles, OAuth callback page), src-tauri/src/local_proxy/error_messages/russian.rs and src-tauri/src/local_proxy/request_error/russian.rs (proxy HTTP and SSE errors), src-tauri/src/system_tray.rs and system_tray/account_label.rs (tray). Keep the Chinese producers unchanged. The proxy tables match the error enums exhaustively, so a new variant needs a Russian arm; a new fixed Chinese message without a Russian entry falls back to the Chinese text. Tests switch language with `storage::with_interface_language`. English arms do not exist yet, so English settings still show the Chinese text on these surfaces.
- Quick menu: the separate webview infers its language from the tray accounts header (apps/desktop/src/components/QuickMenu/language.ts). Keep it in sync with the labels in system_tray.rs.
- Chrome browser assistant: `resources/chrome-extension/_locales/{zh_CN,en,ru}/messages.json` with `default_locale` `zh_CN`. Scripts call `t(name, chineseFallback)` from i18n.js; HTML marks elements with `data-i18n`, `data-i18n-title`, `data-i18n-aria-label` and `data-i18n-placeholder`. List new extension files in `ASSETS` in src-tauri/src/chrome_plugin/extension.rs. A Web Store release needs a version bump and the localized store listing.
- Permission prompts: macOS uses src-tauri/locales/{en,ru,zh-Hans,zh-Hant}.lproj/InfoPlist.strings, bundled through `bundle.macOS.files` in tauri.conf.json; keep the keys in sync with Info.plist and the Chinese files identical to its text. iOS uses apps/native/locales/{en,ru,zh}.json through `expo.locales` in app.json. Android modules receive their labels from JavaScript (apps/native/src/chat/nativeTextSelection.ts, backgroundConnection.ts) and keep Chinese fallbacks.
- HTTP status descriptions: apps/desktop/src/utils/httpStatusRussian.ts (`HTTP_STATUS_RU`), used by httpStatusOptions.ts.
- Client-owned language store: `shared/localization/interfaceLanguage.ts`. Translation and interpolation use `@remoteai/i18n`.
- Native preference persistence: apps/native/src/i18n/preference.ts. Keep startup reads from overwriting newer choices and serialize writes.
- User agreement: shared/legal/ru.ts.
- Use uiText/t only for application copy, never user or assistant content. Subscribe rendered consumers to language changes; do not use translated values as protocol identifiers or state comparisons.
- Preserve boundary spaces in fragments, and prefer complete messages with placeholders. Interpolate once so user values containing braces or replacement tokens stay intact.
- Russian copy uses formal «вы», infinitives for buttons and menu items, «» quotes, the … character and ё. Use the package’s plural messages for inflected counts; existing labels such as «Файлов: {count}» keep their wording.

### Coze editor

Coze is maintained in the [independent submodule](coze-submodule.md). Its translations, tests and signed
releases live in https://github.com/piperhex/remoteai-coze. Desktop integration copy remains in the parent
language package. The desktop sends the initial language in the iframe fragment and subsequent changes
through the versioned bridge; unsaved drafts survive language switches.
