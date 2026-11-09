import { createAsyncGitFixture } from '../../../shared/remote-chat/testing/gitFixture';
import type { GitChange } from '../../../shared/remote-chat/gitTypes';

export const LARGE_GIT_FILE_COUNT = 12_000;

export function largeGitFixture() {
  const client = createAsyncGitFixture();
  let files: GitChange[] = Array.from({ length: LARGE_GIT_FILE_COUNT }, (_, index) => ({
    path: `src/generated/file-${String(index).padStart(5, '0')}.ts`, status: ' M',
    version: `version-${index}`, originalPath: null, conflict: false,
  }));
  const changes = client.changes;
  client.changes = async cwd => ({ ...await changes(cwd), files: [...files] });
  client.commitFiles = async () => Array.from({ length: LARGE_GIT_FILE_COUNT }, (_, index) => ({
    path: `src/generated/file-${String(index).padStart(5, '0')}.ts`, status: 'M', originalPath: null,
  }));
  client.commit = async request => {
    document.body.dataset.gitSubmittedCount = String(request.files.length);
    const selected = new Map(request.files.map(file => [file.path, file.version]));
    files = files.filter(file => selected.get(file.path) !== file.version);
    return { hash: 'a'.repeat(40) };
  };
  return client;
}
