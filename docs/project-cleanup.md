# Project cleanup

Run these commands from the project root. Node.js and Git are required; no additional packages are needed.

```sh
npm run clean:preview                  # Show what would be removed
npm run clean                          # Remove build output and AI scratch files
npm run clean -- --build               # Only build output and test reports
npm run clean -- --ai                  # Only AI scratch files
npm run clean -- --include-submodules --dry-run
npm run clean -- --include-submodules  # Include initialized submodules
npm run test:clean                     # Run cleanup safety tests in temporary repositories
```

Stop development servers, builds, tests and AI tasks before running a cleanup that deletes files.
Preview is safe to use while inspecting the checkout. Deleted scratch files, including screenshots and logs,
cannot be recovered by this script; copy anything you need to keep elsewhere first.

The default scope is the parent repository. The build allowlist includes root `dist` and `.nx`, desktop and
website bundles, website prerender output, Rust targets, browser test output and the two Rust test harnesses.
AI cleanup checks `.codex-tmp`, `.codex-tmp-*`, `.artifacts` and `.tmp` directly under the project root,
`apps/desktop`, `apps/website` and `scripts`. A path must also be ignored by Git to be eligible; unignored
scratch directories are reported and retained. The complete build allowlist lives in
`scripts/lib/clean-project-targets.mjs`.

`--include-submodules` adds known build and scratch output in initialized admin, admin UI, Coze, native,
web, i18n and shared submodules. Missing submodules are skipped. Each child uses its own Git index, HEAD and
ignore rules. The script does not initialize submodules, change revisions or regenerate dependency snapshots.

Source files, build scripts, tracked output, `node_modules`, `.env`, authentication files, `.worktrees`,
`vendor` and `.workspace` outside the selected disposable directories are preserved. A candidate containing
tracked files is retained in full, including files staged for deletion that still exist on disk. Nested Git
repositories, bare repositories, worktrees, symbolic links and directory junctions are retained; other scratch
files beside them can still be removed. The script never follows these links or accepts arbitrary cleanup paths.
It does not sweep all ignored files or delete loose logs outside the allowlisted scratch directories.

The command reports removed paths and skipped paths with reasons. A Git, permission or filesystem error stops
the command with a nonzero exit code. If deletion has already started, earlier successful removals remain in effect.
