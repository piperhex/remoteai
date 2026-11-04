# @remoteai/i18n

Private npm workspace package. Source exports are compiled by each application's Vite, Metro or TypeScript toolchain;
there is no npm publication or separate build step. The root entry has no React, browser, storage or dictionary imports.

## Entries

| Entry | Purpose |
| --- | --- |
| `@remoteai/i18n` | Registry, instance engine, interpolation, plurals, date and number formatting |
| `@remoteai/i18n/react` | `I18nProvider` (`Provider`), `useT`, `useLocale`, `useI18n` |
| `@remoteai/i18n/common`, `/desktop`, `/client`, `/website` | Explicitly imported module resources |
| `@remoteai/i18n/catalogs/<module>/<language>` | One module in one language, default-exported messages |
| `@remoteai/i18n/loader` | Optional dynamic imports by module and language |
| `@remoteai/i18n/errors` | Structured error formatting and decoding of existing service text responses |
| `@remoteai/i18n/copy/<feature>` | Typed structured copy, admin dictionaries and feature-specific presentation tables |
| `@remoteai/i18n/website-content/<module>` | Website copy, feature descriptions, resource lists and their types |
| `@remoteai/i18n/legal/agreement`, `/legal/types` | User agreements and consent copy shared by desktop, web and native |

## Instances and application policies

```ts
import { applications, createI18n } from '@remoteai/i18n';
import { resources } from '@remoteai/i18n/common';

const i18n = createI18n({ locale: 'en', enabledLanguages: applications.native, resources });
i18n.t('common.greeting', { name: 'Ada' });
i18n.t('common.items.count', { count: 2 });
i18n.setLocale('ru');
i18n.formatNumber(1234.5);
i18n.formatDate(new Date(), { dateStyle: 'long' });
```

Create one instance per application root, or per SSR request. Pass it to `<I18nProvider instance={i18n}>`.
Do not export a shared server instance. React consumers refresh on locale changes and resource loads. The website
creates its instance inside `App`; interleaved renders cannot share language state. Existing client adapters keep
their storage keys, Tauri communication, subscriptions and language initialization behavior outside this package.

`languages.json` is the language metadata source, including aliases, display names, direction and fallback.
Its `applications` lists are independent release gates. Use `isAppLanguage(app, value)` for saved preferences and
`languageOptions(applications[app])` for selectors. `resolveLanguage` only recognizes a locale; it does not enable it.
The old device policy deliberately still selects Chinese for Chinese system locales and English otherwise.

## Loading

For browser features that use semantic keys:

```ts
import { createI18n } from '@remoteai/i18n';
import { loadResource } from '@remoteai/i18n/loader';

const i18n = createI18n({ locale: 'ja', loadResource });
await i18n.load('ja', ['common', 'desktop']); // Also loads these modules in fallback languages.
```

Loads are cached per instance, concurrent requests are shared, and failed loads may be retried. Loading resources
never changes the selected locale. The application decides when to call `setLocale`; for async switches it should
discard outdated user selections. A missing key follows the registered fallback chain, then `fallbackLocale`,
then returns the key. A fallback plural uses the language of the message that was found.

Native applications statically import their resources so translations remain available offline. Established client
screens retain eager resources to preserve startup behavior. The lazy loader supports loading individual modules
and languages. The package's root and React entries never import application dictionaries.

## Resources, types and validation

Semantic resources are JSON files under `src/catalogs/<module>/<language>/`. Desktop's existing keys and values are
preserved, split into resource chunks. New keys should use context, such as `common.actions.apply` versus
`downloads.title`. New resource modules are registered in `catalogs.json`; that file also declares each
module's released and draft languages. Structured marketing content, legal documents and existing feature-specific
tables also belong to this package; their public entries preserve their shapes and established fallback policies.

```json
{
  "common.items.count": { "one": "{count} item", "other": "{count} items" }
}
```

Plural variants follow `Intl.PluralRules`; exact variants such as `=0` are supported. Parameters are replaced once,
so values containing braces remain unchanged. Pass plain text to a renderer that escapes it; the engine does not
produce or sanitize HTML. Translate presentation labels only, never database values, status IDs, paths or user text.

Run `npm run generate:i18n` after editing resources or metadata. It validates missing keys, placeholders, plural
categories and release policies, then generates typed keys/parameters, resource indexes, lazy loaders, TypeScript
metadata and the Rust acceptance table. Run `npm run check:i18n` before committing; CI checks generated drift,
TypeScript usage and behavior. Released languages must be complete; drafts may omit resources, but supplied draft
translations must have correct parameters. CI also rejects retired imports and Chinese keys in application calls.

`i18n.t` checks generated semantic keys and parameters. `i18n.text` accepts runtime keys or explicitly imported
dictionaries. Prefer `t` for application copy. Presentation models carry semantic keys; user names, paths, model
IDs and editable content remain literal values. `createErrorFormatter(resources)` accepts `{ code, params, message? }`.
It also decodes existing service text responses against the Chinese resource values at the display boundary.
String transports may JSON-encode the same `{ code, params }` shape. The formatter decodes recognized string
templates with string/number parameters; unrelated or malformed JSON remains ordinary error text.
This decoder is separate from ordinary translation; `i18n.text('复制')` does not translate source text.

## Adding a language (Japanese acceptance example)

1. Add metadata to `languages.json` without adding it to any application's enabled list.
2. Add module translation resources and declare the language as draft in `catalogs.json`.
3. Generate and check. Draft resources may fall back; released resources must pass completeness checks.
4. Complete the modules an application uses, move the language to those modules' released lists, and only then add
   it to that application's enabled list. Include the `client` module for desktop, web and native releases.

Japanese is released in desktop, web, native and the website. Its acceptance covers complete module resources,
saved preferences, live switching with unsaved content, offline native resources and website language routes.
The first-launch policy remains Chinese for a Chinese system locale and English otherwise; saved choices take priority.
The engine tests use intentionally partial resources to verify fallback independently of shipped dictionaries.

The generated Rust table uses **desktop's enabled list**, not all registered languages. Each language declares `nativeText`:
this explicitly selects existing Rust-native resources until that language's native dialogs/notifications are ready.
Adding genuinely new Rust text resources still needs Rust work; a TypeScript dictionary cannot localize native text.
`nativeText` accepts `zh`, `en`, `ru` and `ja`; expanding it requires implementing and testing the native resources.
Japanese includes native notifications, save dialogs, login pages, tray labels and safe proxy error messages.
Structured copy (website content, legal documents and platform permissions) must also be completed before release.

## Resource ownership

All maintained translation resources live in `packages/i18n`. Application adapters own language selection, storage,
React subscriptions and platform integration, but must not introduce translation dictionaries or inline language
branches containing copy. New UI messages should use semantic catalog keys; structured documents and legacy tables
use the narrow public `copy`, `website-content` and `legal` entries, so importing one feature does not load all copy.
Admin's three-language release policy is in `languages.json`. Its Russian dictionary remains deliberately partial
and falls back to English on operator pages; centralizing resources does not release additional languages.

`platform.json` lists the platform resources generated from `platform/`: Chrome extension locale JSON, iOS/macOS
permission descriptions, native Rust translators and embedded JavaScript copy.
Chrome's fallback module and marked HTML defaults are also generated from its Chinese catalog.
The platform tools require files at their existing
application paths, so these are generated outputs, not independent translation sources. Update the package source and
run `npm run generate:i18n`. For embedded copy, only the `i18n:<name>:start/end` section is generated; surrounding
application code stays editable. `check:i18n` rejects changed or missing outputs and inline translation tables in
application source. CI runs this check for application and shared-source changes as well as package changes.

The ownership scan includes application/shared TypeScript, platform JavaScript and build scripts. It rejects bilingual
tuples, concatenated or nested language branches (including English-only leftovers), raw translated JSX text,
accessibility labels, translation parameter fragments, mapped Chinese message keys and unregistered permission resources.
Protocol error matching, user content, theme artwork/provenance metadata and test expectations are not translation
sources. Independent submodules and vendored implementations have their own ownership checks. Generated outputs can contain
translated text; edit their package sources instead.

Default Rust proxy renderers and canonical client status/error tables are package resources too. Classifiers,
serialized error codes and legacy source strings used as protocol values remain in service code. Render these through
the error formatter, which accepts both canonical service text and semantic keys; ordinary `displayText` only looks up
keys. Do not compare a translated label with an old Chinese literal to determine UI state.

Dream skin integrators read released copy through `@remoteai/i18n/tooling/dream-skin` and validate every released
language before changing registries. Add translations to the package first. The integrators no longer rewrite the
desktop language adapter. Nature artwork batch manifests are generated mirrors of the package's tooling resources.

## Application adapters

The old forwarding files and legacy package entry have been removed. Applications use semantic keys and package
resources. `shared/localization` owns client bundle integration, device defaults and the shared UI language store;
storage, Tauri communication and native preferences stay in the applications. This store is never used by the
website server, which creates an instance for each render. Coze is an independent submodule: its own `packages/i18n` owns the editor resources and checks.
Web chat views embedded in desktop inherit and follow the host selection without writing Web language preferences.

The migration regression test fingerprints the original Chinese, English and Russian copy, including explicit
fallback text, independently of the new keys. Update that baseline deliberately when changing existing wording.
The offline native file browser receives its host's language with each settings update, including live switches.
