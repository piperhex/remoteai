# Web repository

`apps/web` is the Git submodule of https://github.com/piperhex/remoteai-web.
It owns its npm lockfile, development commands, tests, build output, Docker context and CI.

## Development

```sh
git submodule update --init shared packages/i18n apps/web
npm ci
npm ci --prefix apps/web
npm run dev:web
```

The Web repository also works when cloned alone: run `npm ci`, `npm run check`, `npm test` and
`npm run dev` there. Production assets go to its `dist/`; its own package version supplies `version.json`.
Parent `build:web` and `check:web` commands delegate to the child explicitly.

Desktop and Web consume common conversation, remote-desktop and download components from `shared`.
Desktop production builds and releases require only shared and i18n; Web is optional unless running Web
or cross-application integration tests. Web is not an npm workspace. Each host declares its dependencies
and deduplicates React, Ant Design and language-package contexts.

## Dependency snapshots

The child preserves existing source import paths. Its standalone runner reconstructs those paths inside
the generated `.workspace/` directory using child sources and pinned snapshots in `vendor/`. Development
commands mirror source changes into that directory; edit the original files, not generated copies.

To update shared dependencies or host integration fixtures, initialize the source repositories used by the relevant
fixtures, then run `npm run export:web` in the parent. Review `vendor/source-lock.json`, run the child's
checks, and commit and push the child before updating its gitlink. Hash checks reject edited snapshots.
Native source is needed when refreshing cross-platform comparison fixtures, not when building the
standalone Web application. Translation resources come from the pinned public `@remoteai/i18n` release.

## Images and deployment

```sh
docker build -t codex-switch/web:local apps/web
```

The Docker build context is now the child directory. Keep the existing `web` service name,
`CODEX_WEB_IMAGE`, `ADMIN_GO_KONG_NETWORK`, gateway alias and Compose override files.
The parent still provides `npm run deploy:web -- check|up|verify --project-name <existing-project>`.
Repository extraction does not deploy or restart production services.

Web CI checks clean Linux and Windows installations and publishes a build artifact. Browser checks use
bundled Playwright Chromium and preserve the Windows password-probe guard. Cross-application chat and
physical-device tests still need a compatible PC/backend fixture; they are separate from standalone CI.
