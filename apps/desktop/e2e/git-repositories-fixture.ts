import type { GitClient } from '../../../shared/remote-chat/gitTypes';
import { createAsyncGitFixture } from '../../../shared/remote-chat/testing/gitFixture';

/** Independent repositories expose accidental parent/child routing in the running UI. */
export function repositoryFixture(root: string): GitClient {
  const childRoot = `${root}/packages/shared`;
  const repositories = [
    { root, path: '', available: true },
    { root: childRoot, path: 'packages/shared', available: true },
    { root: `${root}/apps/native`, path: 'apps/native', available: false },
  ];
  let childRevision = 0;
  let recordedChild = 0;
  const submissions: { operation: string; cwd: string }[] = [];
  const parent = createAsyncGitFixture();
  const child = createAsyncGitFixture();
  const select = (cwd: string) => {
    if (cwd === root) return parent;
    if (cwd === childRoot) return child;
    throw new Error(`Unexpected repository: ${cwd}`);
  };
  const record = (operation: string, cwd: string) => {
    document.body.setAttribute(`data-git-${operation}-cwd`, cwd);
    return select(cwd);
  };
  return {
    ...parent,
    repository: async (cwd, includeChildren) => ({ ...await select(cwd).repository(cwd),
      ...(includeChildren ? { repositories } : {}) }),
    changes: async cwd => {
      const current = await record('changes', cwd).changes(cwd);
      const changes = { ...current, files: current.files.filter(file => ['src/app.ts', 'README.md'].includes(file.path)) };
      return { ...changes, branch: cwd === root ? 'main' : 'feature/shared',
        files: cwd === root ? [{ path: 'packages/shared', originalPath: null,
          status: ' M', conflict: false, version: `child-ref-${childRevision}`, submodule: true,
          referenceChanged: childRevision !== recordedChild }, ...changes.files] : changes.files };
    },
    history: (cwd, skip) => record('history', cwd).history(cwd, skip),
    diff: (cwd, path, commit) => record('diff', cwd).diff(cwd, path, commit),
    commitFiles: (cwd, commit) => record('files', cwd).commitFiles(cwd, commit),
    commit: async input => {
      const result = await record('commit', input.cwd).commit(input);
      if (input.cwd === childRoot) childRevision++;
      else if (input.files.some(file => file.path === 'packages/shared')) recordedChild = childRevision;
      submissions.push({ operation: 'commit', cwd: input.cwd });
      document.body.dataset.gitSubmissions = JSON.stringify(submissions);
      return result;
    },
    action: async input => {
      if (input.action === 'push' && input.cwd === childRoot && new URLSearchParams(location.search).has('failChildPush')) {
        throw new Error('推送未完成，请先拉取远程改动，或检查推送权限与提交检查。');
      }
      await record('action', input.cwd).action(input);
      submissions.push({ operation: input.action, cwd: input.cwd });
      document.body.dataset.gitSubmissions = JSON.stringify(submissions);
    },
    fileAction: input => record('file-action', input.cwd).fileAction(input),
    revision: input => record('revision', input.cwd).revision(input),
    generateMessage: input => record('message', input.cwd).generateMessage(input),
    conflict: (cwd, path) => record('conflict', cwd).conflict(cwd, path),
    resolveConflict: input => record('resolve', input.cwd).resolveConflict(input),
    continueIntegration: (cwd, version) => record('continue', cwd).continueIntegration(cwd, version),
  };
}
