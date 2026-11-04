# Coze submodule

`apps/coze` is a Git submodule of https://github.com/piperhex/remoteai-coze.
It is independently buildable, testable and releasable. Remote AI owns the desktop adapter;
Coze owns the runtime, editor, translations, models and packaging. Neither build imports the other's source.

Initialize it only when developing Coze:

```sh
git submodule update --init apps/coze
cd apps/coze
git switch main
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
cargo test --locked
```

Commit and push inside the submodule first. Then return to the parent and commit `apps/coze` to pin the
verified commit. A normal parent checkout does not need the submodule or its npm dependencies to build.
Parent i18n checks intentionally exclude Coze; the child runs its full ownership and language checks in its CI.

The submodule pointer selects development source. `shared/coze/runtime.json` independently selects the
downloadable runtime; updating one does not silently update the other. Promote that registry only after all
five signed platform packages are published. Run `node scripts/check-coze-release.mjs` before promotion.
The registry also pins the dedicated Coze signing public key. Existing installations retain their data directory.

Coze pushes and PRs run its own CI. Tags `coze-v*`, or an explicit publish dispatch, publish immutable releases
in `piperhex/remoteai-coze`. Remote AI validates the pinned release without rebuilding the optional component.
