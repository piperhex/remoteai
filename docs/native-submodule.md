# Independent native application

`apps/native` is the optional [remoteai-native](https://github.com/piperhex/remoteai-native) Git submodule.
It owns Android/iOS dependencies, tests, build configuration, version numbers and GitHub releases.
The migration retains the native directory's 990 historical commits.

Desktop and web installation, checks and releases do not initialize or build this submodule. To work on mobile:

```sh
git submodule update --init apps/native
npm --prefix apps/native ci
npm --prefix apps/native run check
npm --prefix apps/native test
npm --prefix apps/native run check:i18n
npm run build:apk
```

Native consumes the independently published `@remoteai/i18n` package and versioned shared/Rust dependency snapshots.
Refresh generated dependencies after committing source changes in their owning repositories:

```sh
npm run export:native
npm --prefix apps/native install
npm --prefix apps/native run generate:assets
npm --prefix apps/native run generate:i18n
```

Review `apps/native/vendor/source-lock.json`, rerun the native checks and Android/iOS exports, then commit and push
the native repository before updating its parent gitlink. Native-only regression tests live in that repository;
explicit Android/embedded-WebView integration harnesses in the parent still require an initialized native checkout.

The native repository's `v*` tags publish an APK, unsigned iOS application archive and checksums after CI succeeds.
The parent `npm run release` changes desktop versions only. Parent release notes link to native releases when no
legacy mobile assets are attached. Existing iOS artifacts remain unsigned; Apple distribution is a separate setup.

Native update metadata now comes from `piperhex/remoteai-native`. Android installation validation and desktop peer
caching accept both official repositories so older packages remain compatible. The Go backend keeps the native
mirror in `UPDATE_CACHE_DIR/native` and serves `/native-update-packages`; desktop cache paths are unchanged.
Deploy the corresponding backend and Kong changes through the normal deployment workflow to enable that mirror.
Until then, native clients retain their GitHub download fallback. This source migration does not deploy services.

Older installed mobile builds still check the parent repository. Install the first independent APK manually once
to switch those devices to the native repository's update feed. No release tag is created by the source migration.
