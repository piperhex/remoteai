# Independent language package

`packages/i18n` is the required language-package submodule from
https://github.com/piperhex/remoteai-i18n. Its history, resources, generator, tests and releases live there.
Admin and admin UI consume the same published language package with their own integration profiles.
Coze retains its own language package. All application submodules retain independent builds and CI.

Initialize the language source before installing or building the parent:

```sh
git submodule update --init shared packages/i18n
npm ci
npm run generate:i18n
npm run check:i18n
```

To change language resources, switch to a development branch inside `packages/i18n`, edit and validate there,
then commit and push the child first. Commit the new parent gitlink after regenerating and checking consumer
resources. The parent checks both platform output drift and application translation ownership; child CI checks
the complete package and its installable release independently.

The child uses source exports in this workspace, preserving Vite and Metro development behavior. Independent
consumers can install its compiled ESM package and declarations from an immutable GitHub Release:

```sh
npm install https://github.com/piperhex/remoteai-i18n/releases/download/i18n-v0.1.2/remoteai-i18n-0.1.2.tgz
```

Release checksums are published alongside the archive. The package is not published to npmjs.org automatically.
The optional React adapter remains a peer dependency. Other applications can use the public integration CLI
with their own platform manifest; see the child README for commands and the explicit host-root requirement.

Admin UI installs the immutable published language package directly. `npm run export:admin-ui` only builds
the shared-component archive and pins the language release; it does not copy translation sources into vendor.
The admin backend uses the package's `admin` profile to generate and check its Go messages, including Docker
build validation. Run each child's checks and push it before updating its parent gitlink.
