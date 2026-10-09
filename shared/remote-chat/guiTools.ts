import type { TerminalRead, TerminalInfo, TerminalSize } from '../terminal/types';
import { desktopClient } from '../remote-desktop/protocol';
import { createReviewClient } from './taskReview';
import type { GitRequest, GitStatus } from './gitWorkspace';
import { PROJECT_LIST_OPERATION, PROJECT_SELECT_OPERATION, type ProjectSelection } from './projects';
import type { ChatProject } from './client/types';
import type { GitActionRequest, GitChanges, GitCommitFile, GitCommitRequest, GitDiff, GitHistory,
  GitRepository } from './gitTypes';

export interface CliRelease { version: string; size: number; ready?: boolean }
export interface CliProgress { downloaded: number; total: number; phase: 'downloading' | 'installing' }
export interface RemoteCliStatus {
  version: string | null;
  release?: CliRelease | null;
  installing: boolean;
  progress: CliProgress | null;
  error: string;
}
export const GUI_TOOL_OPERATIONS = new Set([
  PROJECT_LIST_OPERATION, PROJECT_SELECT_OPERATION,
  'guiCliStatus', 'guiCliRelease', 'guiCliInstall', 'guiReconnect',
  'guiTerminalList', 'guiTerminalOpen', 'guiTerminalRead', 'guiTerminalWrite', 'guiTerminalResize', 'guiTerminalClose',
  'guiGitChanges', 'guiGitDiff', 'guiGitHistory', 'guiGitCommit', 'guiGitCommitFiles',
  'guiGitRepository', 'guiGitAction', 'guiGitWorkspace',
  'guiTaskReview', 'guiTaskRestore',
]);

/** Requests use the selected computer's authenticated chat connection. */
export function createGuiToolsClient(request: <T>(body: object) => Promise<T>,
  diagnostic?: import('./diagnostics').ConnectionDiagnostic,
  nativeMedia?: import('../remote-desktop/nativeMedia').NativeMediaFactory) {
  return {
    projects: {
      list: () => request<ChatProject[]>({ operation: PROJECT_LIST_OPERATION }),
      select: (input: ProjectSelection) => request<ChatProject>({ ...input, operation: PROJECT_SELECT_OPERATION }),
    },
    review: createReviewClient(request),
    desktop: desktopClient(request, diagnostic, nativeMedia),
    status: () => request<RemoteCliStatus>({ operation: 'guiCliStatus' }),
    release: () => request<CliRelease>({ operation: 'guiCliRelease' }),
    install: (version: string) => request<RemoteCliStatus>({ operation: 'guiCliInstall', version }),
    reconnect: () => request<void>({ operation: 'guiReconnect' }),
    workspace: (input: GitRequest) => request<GitStatus>({ operation: 'guiGitWorkspace', request: input }),
    git: {
      repository: (cwd: string) => request<GitRepository>({ operation: 'guiGitRepository', cwd }),
      action: (input: GitActionRequest) => request<void>({ ...input, operation: 'guiGitAction' }),
      changes: (cwd: string) => request<GitChanges>({ operation: 'guiGitChanges', cwd }),
      diff: (cwd: string, path: string, commit?: string) =>
        request<GitDiff>({ operation: 'guiGitDiff', cwd, path, commit }),
      history: (cwd: string, skip: number) => request<GitHistory>({ operation: 'guiGitHistory', cwd, skip }),
      commitFiles: (cwd: string, commit: string) =>
        request<GitCommitFile[]>({ operation: 'guiGitCommitFiles', cwd, commit }),
      commit: (input: GitCommitRequest) => request<{ hash: string }>({ ...input, operation: 'guiGitCommit' }),
    },
    terminal: {
      list: (cwd: string) => request<TerminalInfo[]>({ operation: 'guiTerminalList', cwd }),
      open: (cwd: string, size: TerminalSize) =>
        request<TerminalInfo>({ operation: 'guiTerminalOpen', cwd, size }),
      read: (id: string, cursor: number) => request<TerminalRead>({ operation: 'guiTerminalRead', id, cursor }),
      write: (id: string, data: string) => request<void>({ operation: 'guiTerminalWrite', id, data }),
      resize: (id: string, size: TerminalSize) => request<void>({ operation: 'guiTerminalResize', id, size }),
      close: (id: string) => request<void>({ operation: 'guiTerminalClose', id }),
    },
  };
}

export type GuiToolsClient = ReturnType<typeof createGuiToolsClient>;
