import { threadActionReason } from './threadActions';
import type { ChatState, Thread } from './types';

export function forkUnavailableReason(state: ChatState, thread: Thread): string {
  if (state.archived) return '恢复对话后即可继续';
  if (state.workspaceBusy || state.settingsBusy) return '请等待当前操作完成。';
  return threadActionReason(state, thread, 'archive');
}

interface Host {
  snapshot: () => ChatState;
  update: (patch: Partial<ChatState>) => void;
  request: () => Promise<{ thread: Thread }>;
  isCurrent: () => boolean;
  canOpen: () => boolean;
  select: (thread: Thread) => Promise<void>;
  refresh: () => Promise<void>;
}

export async function forkConversation(host: Host, source: Thread): Promise<boolean> {
  if (forkUnavailableReason(host.snapshot(), source)) return false;
  host.update({ threadActionBusy: source.id, error: '' });
  try {
    const { thread } = await host.request();
    if (!host.isCurrent()) return false;
    if (host.canOpen()) {
      host.update({ archived: false, search: '' });
      await host.select(thread);
    }
    await host.refresh();
    return true;
  } catch (error) {
    if (host.isCurrent()) host.update({ error: error instanceof Error ? error.message : '操作未完成，请稍后重试。' });
    return false;
  } finally { host.update({ threadActionBusy: undefined }); }
}
