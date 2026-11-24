import { createGitFixture } from '../../../shared/remote-chat/testing/gitFixture';
import type { GitActionRequest, GitCommitRequest, GitFileActionRequest,
  GitRevisionRequest, GitMessageRequest } from '../../../shared/remote-chat/gitTypes';

const git = createGitFixture();
export function demoGitTools(input: Record<string, unknown>) {
  const cwd = String(input.cwd);
  switch (input.operation) {
    case 'guiGitSettings': return git.settings(input.autoMessage as boolean | undefined);
    case 'guiGitGenerateMessage': return git.generateMessage(input as unknown as GitMessageRequest);
    case 'guiGitRepository': return git.repository(cwd);
    case 'guiGitAction': return git.action(input as unknown as GitActionRequest) ?? null;
    case 'guiGitRevision': return git.revision(input as unknown as GitRevisionRequest) ?? null;
    case 'guiGitChanges': return git.changes(cwd);
    case 'guiGitHistory': return git.history(cwd, Number(input.skip));
    case 'guiGitCommitFiles': return git.commitFiles(cwd, String(input.commit));
    case 'guiGitWorkspaceDiff':
    case 'guiGitDiff': return git.diff(cwd, String(input.path), input.commit as string | undefined);
    case 'guiGitCommit': return git.commit(input as unknown as GitCommitRequest);
    case 'guiGitFileAction': return git.fileAction(input as unknown as GitFileActionRequest) ?? null;
  }
}
