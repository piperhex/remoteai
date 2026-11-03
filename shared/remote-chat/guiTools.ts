import type { TerminalRead, TerminalInfo, TerminalSize, TerminalLaunchOptions } from '../terminal/types';
import type { SshApi, SshConnect, SshEndpoint, SshFileAction, SshFileReply, SshX11 } from '../terminal/ssh';
import type { SshProfileStore } from '../terminal/sshProfiles';
import { createProjectBrowserClient } from '../project-browser/protocol';
import { projectDownloads } from '../project-browser/downloads';
import { createGuiFilesClient } from './files';
import type { TerminalLinkRequest, TerminalLinkReply } from '../terminal/links';
import { desktopClient } from '../remote-desktop/protocol';
import { createReviewClient } from './taskReview';
import type { GitRequest, GitStatus } from './gitWorkspace';
import { PROJECT_LIST_OPERATION, PROJECT_SELECT_OPERATION, type ProjectSelection } from './projects';
import type { ChatProject } from './client/types';
import { CODEX_STATUS_OPERATION, type CodexServiceStatus } from '../codex-status/status';
import type { GitActionRequest, GitChanges, GitCommitFile, GitCommitRequest, GitDiff, GitHistory,
  GitFileActionRequest, GitRepository, GitRevisionRequest, GitMessageRequest, GitSettings,
  GitConflict, GitResolution } from './gitTypes';

export interface CliRelease { version: string; size: number; ready?: boolean }
const unavailableProfiles: SshProfileStore = {
  list: async () => { throw new Error('client.ssh.updateRequired'); },
  save: async () => { throw new Error('client.ssh.updateRequired'); },
  remove: async () => { throw new Error('client.ssh.updateRequired'); },
};
export interface CliProgress { downloaded: number; total: number; phase: 'downloading' | 'installing' }
export interface RemoteCliStatus {
  version: string | null;
  release?: CliRelease | null;
  installing: boolean;
  progress: CliProgress | null;
  error: string;
}
export const GUI_TOOL_OPERATIONS = new Set([
  CODEX_STATUS_OPERATION,
  'guiBrowser',
  PROJECT_LIST_OPERATION, PROJECT_SELECT_OPERATION,
  'guiCliStatus', 'guiCliRelease', 'guiCliInstall', 'guiReconnect',
  'guiTerminalList', 'guiTerminalOpen', 'guiTerminalRead', 'guiTerminalWrite', 'guiTerminalResize', 'guiTerminalClose',
  'guiTerminalLink', 'guiTerminalWriteBinary', 'guiTerminalBinaryMode',
  'guiTerminalSshProbe', 'guiTerminalSshOpen', 'guiTerminalSshFiles',
  'guiTerminalSshEnsureX11',
  'guiTerminalSshProfiles', 'guiTerminalSshProfileSave', 'guiTerminalSshProfileRemove',
  'guiGitChanges', 'guiGitDiff', 'guiGitHistory', 'guiGitCommit', 'guiGitCommitFiles',
  'guiGitRepository', 'guiGitAction', 'guiGitFileAction', 'guiGitWorkspace', 'guiGitRevision',
  'guiGitGenerateMessage',
  'guiGitSettings',
  'guiGitConflict', 'guiGitResolveConflict', 'guiGitContinueIntegration',
  'guiTaskReview', 'guiTaskRestore',
]);

/** Requests use the selected computer's authenticated chat connection. */
export function createGuiToolsClient(request: <T>(body: object) => Promise<T>,
  diagnostic?: import('./diagnostics').ConnectionDiagnostic,
  nativeMedia?: import('../remote-desktop/nativeMedia').NativeMediaFactory,
  stream?: import('../port-mapping/socket').MappingSocketFactory) {
  const ssh: SshApi = {
    profiles: unavailableProfiles,
    probe: (endpoint: SshEndpoint) => request<string>({ operation: 'guiTerminalSshProbe', endpoint }),
    ensureX11: (options: SshX11) => request<void>({ operation: 'guiTerminalSshEnsureX11', options }),
    open: (input: SshConnect, cwd: string) =>
      request<TerminalInfo>({ operation: 'guiTerminalSshOpen', request: input, cwd }),
    files: (id: string, input: SshFileAction) =>
      request<SshFileReply>({ operation: 'guiTerminalSshFiles', id, request: input }),
  };
  return {
    serviceStatus: () => request<CodexServiceStatus>({ operation: CODEX_STATUS_OPERATION }),
    browser: (input: import('../browser/automation').BrowserRequest) =>
      request<import('../browser/automation').BrowserReply>({ operation: 'guiBrowser', request: input }),
    projectBrowser: createProjectBrowserClient(request, projectDownloads(request)),
    files: createGuiFilesClient(request, stream),
    projects: {
      list: () => request<ChatProject[]>({ operation: PROJECT_LIST_OPERATION }),
      select: (input: ProjectSelection) => request<ChatProject>({ ...input, operation: PROJECT_SELECT_OPERATION }),
      moveThread: (threadId: string, cwd: string) =>
        request<ChatProject & { sidebar: import('./sidebar').SidebarSnapshot }>({
          operation: PROJECT_SELECT_OPERATION, threadId, cwd, removeFromGroup: true,
        }),
    },
    review: createReviewClient(request),
    desktop: desktopClient(request, diagnostic, nativeMedia),
    status: () => request<RemoteCliStatus>({ operation: 'guiCliStatus' }),
    release: () => request<CliRelease>({ operation: 'guiCliRelease' }),
    install: (version: string) => request<RemoteCliStatus>({ operation: 'guiCliInstall', version }),
    reconnect: () => request<void>({ operation: 'guiReconnect' }),
    workspace: (input: GitRequest) => request<GitStatus>({ operation: 'guiGitWorkspace', request: input }),
    git: {
      conflict: (cwd: string, path: string) => request<GitConflict>({ operation: 'guiGitConflict', cwd, path }),
      resolveConflict: (input: GitResolution) => request<void>({ ...input, operation: 'guiGitResolveConflict' }),
      continueIntegration: (cwd: string, version: string) =>
        request<void>({ operation: 'guiGitContinueIntegration', cwd, version }),
      settings: (autoMessage?: boolean) => request<GitSettings>({ operation: 'guiGitSettings', autoMessage }),
      generateMessage: (input: GitMessageRequest) =>
        request<{ message: string }>({ ...input, operation: 'guiGitGenerateMessage' }),
      revision: (input: GitRevisionRequest) => request<void>({ ...input, operation: 'guiGitRevision' }),
      repository: (cwd: string) => request<GitRepository>({ operation: 'guiGitRepository', cwd }),
      action: (input: GitActionRequest) => request<void>({ ...input, operation: 'guiGitAction' }),
      changes: (cwd: string) => request<GitChanges>({ operation: 'guiGitChanges', cwd }),
      diff: (cwd: string, path: string, commit?: string) =>
        request<GitDiff>({ operation: 'guiGitDiff', cwd, path, commit }),
      history: (cwd: string, skip: number) => request<GitHistory>({ operation: 'guiGitHistory', cwd, skip }),
      commitFiles: (cwd: string, commit: string) =>
        request<GitCommitFile[]>({ operation: 'guiGitCommitFiles', cwd, commit }),
      commit: (input: GitCommitRequest) => request<{ hash: string }>({ ...input, operation: 'guiGitCommit' }),
      fileAction: (input: GitFileActionRequest) => request<void>({ ...input, operation: 'guiGitFileAction' }),
    },
    terminal: {
      ssh,
      link: (id: string, input: TerminalLinkRequest) =>
        request<TerminalLinkReply>({ operation: 'guiTerminalLink', id, request: input }),
      list: (cwd: string) => request<TerminalInfo[]>({ operation: 'guiTerminalList', cwd }),
      open: (cwd: string, size: TerminalSize, projectCwd?: string, options?: TerminalLaunchOptions) =>
        request<TerminalInfo>({ operation: 'guiTerminalOpen', cwd, size, ...options,
          ...(projectCwd === undefined ? {} : { projectCwd }) }),
      read: (id: string, cursor: number, token?: string) =>
        request<TerminalRead>({ operation: 'guiTerminalRead', id, cursor, token }),
      write: (id: string, data: string) => request<void>({ operation: 'guiTerminalWrite', id, data }),
      writeBinary: (id: string, data: number[]) => request<void>({ operation: 'guiTerminalWriteBinary', id, data }),
      binaryMode: (id: string, token: string, enabled: boolean) =>
        request<void>({ operation: 'guiTerminalBinaryMode', id, token, enabled }),
      resize: (id: string, size: TerminalSize) => request<void>({ operation: 'guiTerminalResize', id, size }),
      close: (id: string) => request<void>({ operation: 'guiTerminalClose', id }),
    },
  };
}

export type GuiToolsClient = ReturnType<typeof createGuiToolsClient>;
