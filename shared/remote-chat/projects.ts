import type { ChatState } from './client/types';

export const PROJECT_LIST_OPERATION = 'guiProjects';
export const PROJECT_SELECT_OPERATION = 'guiProjectSelect';
export interface ProjectSelection { cwd: string; threadId?: string }

export function canSelectProject(state: ChatState) {
  const thread = state.selected;
  return state.ready && !state.sending && !state.workspaceBusy && !state.selectedArchived
    && !state.threadActionBusy && !state.goalBusy && !state.compacting && !state.queueBusy
    && !(state.historyLoading && !thread?.turns)
    && !thread?.turns?.some(turn => turn.status === 'inProgress')
    && !(thread && (state.sidebar.threads[thread.id]?.running || state.queue.threads[thread.id]?.length
      || state.approvals.some(event => event.params.threadId === thread.id)));
}
