import { invoke } from '../../api/backend';
import type { GitClient } from '../../../../../shared/remote-chat/gitTypes';

/** Use the same Git service as remote viewers, on this computer's native command worker. */
export const localGitClient: GitClient = {
  conflict: (cwd, path) => invoke('codex_gui_git_tool', { request: { operation: 'conflict', cwd, path } }),
  resolveConflict: request => invoke('codex_gui_git_tool', { request: { ...request, operation: 'resolveConflict' } }),
  continueIntegration: (cwd, version) =>
    invoke('codex_gui_git_tool', { request: { operation: 'continueIntegration', cwd, version } }),
  settings: autoMessage => invoke('codex_gui_git_tool', { request: { operation: 'settings', autoMessage } }),
  generateMessage: request => invoke('codex_gui_git_tool', { request: { ...request, operation: 'generateMessage' } }),
  revision: request => invoke('codex_gui_git_tool', { request: { ...request, operation: 'revision' } }),
  repository: (cwd, includeChildren) =>
    invoke('codex_gui_git_tool', { request: { operation: 'repository', cwd, includeChildren } }),
  action: request => invoke('codex_gui_git_tool', { request: { ...request, operation: 'action' } }),
  changes: cwd => invoke('codex_gui_git_tool', { request: { operation: 'changes', cwd } }),
  diff: (cwd, path, commit) => invoke('codex_gui_git_tool', { request: { operation: 'diff', cwd, path, commit } }),
  history: (cwd, skip) => invoke('codex_gui_git_tool', { request: { operation: 'history', cwd, skip } }),
  commitFiles: (cwd, commit) => invoke('codex_gui_git_tool', { request: { operation: 'commitFiles', cwd, commit } }),
  commit: request => invoke('codex_gui_git_tool', { request: { ...request, operation: 'commit' } }),
  fileAction: request => invoke('codex_gui_git_tool', { request: { ...request, operation: 'fileAction' } }),
};
