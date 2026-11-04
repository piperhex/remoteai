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
The parent `npm run release` changes desktop versions only. Every full parent release downloads the latest stable
Native release, verifies its `SHA256SUMS`, and attaches the original APK and unsigned iOS archive to the parent
GitHub Release. Users can download the mobile packages directly from the main repository's release page.
Existing iOS artifacts remain unsigned; Apple distribution is a separate setup.

The `native-release-assets` job runs without checking out Native or installing its dependencies. It copies
`SHA256SUMS` as `native-SHA256SUMS` and writes `native-release.json` with the source repository, release ID, tag,
file sizes and hashes. This manifest pins the selection for retries, including interrupted uploads. Existing
identical assets are verified and reused; conflicting or incomplete assets fail without replacement. Existing
historical mobile packages are preserved. The main release cannot be published if synchronization fails or
Native has no stable release yet. Publish Native first. Linux-only and Unix-only rebuilds skip synchronization.

For a manual full release run, optional `native_tag` selects a specific published stable Native version instead
of latest. After a source has been recorded, retries must use that version. Native and desktop versions may
differ: filenames and APK bytes retain the Native version. No APK is embedded inside desktop installers.

Native update metadata now comes from `piperhex/remoteai-native`. Android installation validation and desktop peer
caching accept both official repositories so older packages remain compatible. The Go backend keeps the native
mirror in `UPDATE_CACHE_DIR/native` and serves `/native-update-packages`; desktop cache paths are unchanged.
Deploy the corresponding backend and Kong changes through the normal deployment workflow to enable that mirror.
Until then, native clients retain their GitHub download fallback. This source migration does not deploy services.

Older installed Android builds still check the parent repository. They can discover the mirrored APK there and
install it through their existing update flow; after installation they use the Native repository's update feed.
For the first migration, the parent tag must be newer than the installed app's version, and the selected Native
APK must retain the package ID and signing key with a strictly higher Android `versionCode`. Copying a same-version
or older APK cannot upgrade those devices. Publish a newer Native version before the next parent release to cover
the latest legacy clients. Android still requires the usual installation confirmation. Neither the source migration
nor this synchronization configuration creates a Native release tag or modifies existing published releases.
