# Safe Git Pull and Update

Pull and Update share Merge/Rebase selection and preserve local edits. Fetch happens first without
changing the worktree; branch, HEAD and operation state are rechecked before integrating the pinned
fetched commit. Failures in the fetch phase leave local files and the index untouched.

## Saving and restoring

- Tracked, unstaged edits use Git's native `--autostash` when supported. A separate safety snapshot is
  pinned before integration, so recovery does not depend on parsing Git's terminal output.
- Staged changes, mixed staged/unstaged files and untracked files use `git stash push --include-untracked`
  followed by `git stash apply --index <object-id>`. This preserves the index as well as file contents.
- Capability detection reads command help before mutation. An unsupported native option selects explicit
  stashing; it never retries an integration that might already have run.
- Successful restoration removes only the task's own stash and safety reference. Existing stashes remain.
- All commands remain under the existing workspace mutation guard and execute on a blocking worker,
  outside the Windows UI thread. Polling continues to use the existing single-flight request hook.

## Conflicts and interrupted operations

An unsuccessful Merge/Rebase remains available in the existing conflict editor. Continue completes
the integration and restores the saved edits. Unmerged files after native autostash count as a restoration
failure even when Git exits with status zero. A changed stash reference also flags native restoration
failures that leave no unmerged index entries, including index-lock failures. Restoration conflicts use the same editor, with labels
for the updated version and saved local changes.

The per-worktree recovery record is stored at `git rev-parse --git-path remoteai-update.json`.
Backups are pinned under `refs/remoteai/update/<uuid>`; explicit stashes also remain in the stash list
until restoration succeeds. Restoration failures and ambiguous interruptions never remove the backup.
The record is written before applying a stash, preventing automatic reapplication after a process stops
mid-restore. Acknowledging a reviewed recovery clears the pending operation but retains its backup.

The UI provides the exact backup object ID and inspection command. To locate retained safety copies:

```sh
git for-each-ref --format='%(refname) %(objectname)' refs/remoteai/update/
git stash list
git stash show --include-untracked --patch <object-id>
```

If recovery must be repeated, inspect the current files first. Apply the full backup in a separate,
clean worktree to avoid duplicating changes already restored in the original worktree:

```sh
git stash apply --index <object-id>
```

Untracked name collisions retain the remote file and the backup's untracked content. They can require
manual recovery because Git does not represent those collisions as normal unmerged index entries.
Changed submodule commit references are rejected before saving: Git stash cannot reliably preserve
nested worktrees. The UI explains that their references need to be committed or reconciled first.

## Verification

Rust Git tests use temporary offline remote/local repositories and cover Merge/Rebase, both actions,
staged/unstaged/untracked changes, renames/deletions, existing stashes, network failures, integration
continuation, native restoration conflicts, untracked collisions and interrupted restoration.

The shared UI and local/remote adapters have unit tests. Playwright fixtures run the actual Git components
and host themes with a controlled transport, covering desktop local, desktop remote and standalone Web
at default and enlarged font preferences, in light/dark modes. Screenshots cover dirty confirmation,
in-progress updates, completion, recovery guidance and the conflict editor. Backend Git behavior is
verified separately from these transport-controlled UI fixtures.
