# Git tool regression

The isolated fixture uses `com.codexswitch.mobile.gittest` and in-memory Git data.
It never modifies a real repository or replaces the installed Remote AI app.

From `apps/native/android`, with Java and the Android SDK configured:

```powershell
$env:NODE_ENV = 'production'
$env:NODE_PATH = (Resolve-Path ../node_modules).Path
.\gradlew.bat assembleRelease -I ../e2e/git.init.gradle -PreactNativeArchitectures=x86_64
node ../e2e/git-tools.mjs
```

The script requires `emulator-5580` (or set `ANDROID_SERIAL` to another emulator).
Set `ANDROID_GIT_APK` to a saved fixture APK when another build shares the Android output directory.
It checks the tools menu, folder selection, flat/tree views, diff navigation, committing,
merge history, branch switching, Fetch/Pull/Push and Update Project with automatic merge.
Opening a commit must show its file list first; selecting a file opens only that diff.
Both back steps are checked, with screenshots of the list and selected file diff.
Screenshots, including the open keyboard, are saved in
`.codex-tmp/git-tools-android/`. Inspect them for clipping and readable graph edges.

The shared hook tests cover stale project requests, conflict/offline states,
failed commits and graph continuity. Rust tests use temporary repositories to
verify selected commits, unrelated staging, hooks, renames, deletions and history.
Remote-action Rust tests use local repositories to check dirty-worktree protection,
merge/rebase, conflict retention, branch tracking, and refusal to force-push.
Web coverage is `apps/web/e2e/chat-git.pw.ts` at phone and desktop widths.

Update Project fetches all remotes in the current repository and automatically merges its
tracked branch, using `Merge remote-tracking branch 'origin/master'` with the actual tracking
branch name when a merge commit is needed. Fast-forward updates do not create an extra commit.
Pull fetches only the tracked remote and still supports choosing merge or rebase.
Both require a clean worktree and retain commit hooks. No automatic stash, submodule update
or multi-root project update is performed.
Resolve integration conflicts on the computer or through the terminal before retrying.
