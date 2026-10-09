import { invoke } from '../api/backend';
import { guiApi } from '../pages/codexGui/api';
import { getGuiController } from '../pages/codexGui/session';
import { subscribeGuiEvent } from '../pages/codexGui/webEvents';
import type { CliProgress, CliRelease, RemoteCliStatus } from '../../../../shared/remote-chat/guiTools';
import { workspaceRequest } from './gitWorkspace';

// A download continues when its requesting computer disconnects and is visible after reconnecting.
let installing = false;
let progress: CliProgress | null = null;
let installError = '';

function requireIdle() {
  const state = getGuiController().getSnapshot();
  if (state.sending || state.workspaceBusy || state.approvals.length
    || Object.values(state.conversations).some(conversation => conversation.activeTurn)) {
    throw new Error('远程电脑上还有任务在运行，请等任务完成后再试。');
  }
}

async function status(): Promise<RemoteCliStatus> {
  const cli = await invoke<Pick<RemoteCliStatus, 'version' | 'release'>>('codex_gui_cli_status');
  return { ...cli, installing, progress, error: installError };
}

async function install(version: string) {
  let unsubscribe: (() => void) | undefined;
  try {
    unsubscribe = await subscribeGuiEvent<CliProgress>('codex-gui-download', value => { progress = value; });
    await invoke('codex_gui_cli_install', { version });
    // If another task started during the download, connect keeps its running server alive.
    await guiApi.connect();
  } catch { installError = '远程 Codex 更新未完成，请稍后重试。'; }
  finally { unsubscribe?.(); installing = false; }
}

export async function guiToolRequest(body: Record<string, unknown>) {
  switch (body.operation) {
    case 'guiGitWorkspace': return workspaceRequest(body.request);
    case 'guiTaskReview': return invoke('codex_gui_git_tool', { request: { ...body, operation: 'review' } });
    case 'guiTaskRestore': {
      if (body.preview !== true && (typeof body.expectedVersion !== 'string'
        || !/^[a-f0-9]{64}$/.test(body.expectedVersion))) {
        throw new Error('请先预览恢复影响，再确认恢复。');
      }
      return invoke('codex_gui_undo', { request: body });
    }
    case 'guiGitRepository': return invoke('codex_gui_git_tool', { request: { ...body, operation: 'repository' } });
    case 'guiGitAction': return invoke('codex_gui_git_tool', { request: { ...body, operation: 'action' } });
    case 'guiGitChanges': return invoke('codex_gui_git_tool', { request: { ...body, operation: 'changes' } });
    case 'guiGitDiff': return invoke('codex_gui_git_tool', { request: { ...body, operation: 'diff' } });
    case 'guiGitHistory': return invoke('codex_gui_git_tool', { request: { ...body, operation: 'history' } });
    case 'guiGitCommitFiles': return invoke('codex_gui_git_tool', { request: { ...body, operation: 'commitFiles' } });
    case 'guiGitCommit': return invoke('codex_gui_git_tool', { request: { ...body, operation: 'commit' } });
    case 'guiCliStatus': return status();
    case 'guiCliRelease': return invoke<CliRelease>('codex_gui_cli_check');
    case 'guiCliInstall': {
      if (installing) throw new Error('远程 Codex 正在更新，请稍候。');
      if (typeof body.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(body.version)) {
        throw new Error('版本信息无效，请重新检查版本。');
      }
      requireIdle();
      installing = true; progress = null; installError = '';
      void install(body.version);
      return status();
    }
    case 'guiReconnect':
      if (installing) throw new Error('远程 Codex 正在更新，请稍候。');
      requireIdle();
      await guiApi.connect();
      return;
    default: throw new Error('请更新远程电脑上的 Remote AI 后重试。');
  }
}
