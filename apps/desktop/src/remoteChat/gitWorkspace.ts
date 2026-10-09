import { invoke } from '../api/backend';
import { getGuiController } from '../pages/codexGui/session';
import { object } from '../../../../shared/remote-chat/protocol';
import type { GitStatus } from '../../../../shared/remote-chat/gitWorkspace';

export async function workspaceRequest(input: unknown): Promise<GitStatus> {
  const request = object(input);
  if (!['status', 'switch', 'createWorktree'].includes(String(request.operation))) {
    throw new Error('操作无效，请重新选择。');
  }
  // The typed Rust command validates paths and branches and runs Git on a blocking worker.
  if (request.operation === 'status') return invoke('codex_gui_git', { request });
  const controller = getGuiController();
  const state = controller.getSnapshot();
  if (state.sending || state.workspaceBusy) throw new Error('项目正在处理中，请稍后重试。');
  controller.setWorkspaceBusy(true);
  try { return await invoke('codex_gui_git', { request }); }
  finally { controller.setWorkspaceBusy(false); }
}
