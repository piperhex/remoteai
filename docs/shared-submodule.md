# Shared source repository

`shared/` is the required Git submodule of https://github.com/piperhex/remoteai-shared.
The extracted repository preserves the directory's history and the existing application import paths.
Shared sources are required for parent desktop and Web builds, including Rust resources embedded with
`include_str!` and `include_bytes!`. The independent Native repository consumes an exported shared snapshot.

## Checkout and development

```sh
git submodule update --init shared
npm ci
npm run build:desktop
npm --prefix apps/web run check
npm run check:i18n
```

After switching parent branches or pulling a new gitlink, run `git submodule update --init shared` again.
Do not use `--remote` for builds: the parent pins the tested shared revision.

Shared remains a source repository. Some shared components and protocol types depend on application
adapters in `apps/desktop`; this migration preserves those relationships. Its CI validates against a
pinned compatible application checkout. Translation resources continue to belong to `@remoteai/i18n`.

## Updating shared code

Make the change inside `shared/`, validate the affected consumers and commit and push in that repository
first. Then commit `shared` in the parent to select the published commit. UI behavior changes still need
the usual parity and screenshot verification; changing the repository boundary alone changes no UI.

Admin UI consumes generated archives using `npm run export:admin-ui`. Native uses `npm run export:native`;
initialize it and install its dependencies before running `npm --prefix apps/native run check` and its tests.
Both exports record the parent and shared repository revisions alongside source hashes. Never edit generated
dependencies. See [Native development and releases](native-submodule.md) for its complete validation commands.

The parent still controls desktop integration with Coze. Its signed runtime pin remains at
`shared/coze/runtime.json`; changes to that file now follow the shared-child-first commit order.
