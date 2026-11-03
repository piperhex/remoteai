import type { ChatState } from './client/types';

export const PROJECT_LIST_OPERATION = 'guiProjects';
export const PROJECT_SELECT_OPERATION = 'guiProjectSelect';
export const PROJECT_PIN_OPERATION = 'guiProjectPin';
export const PROJECT_REMOVE_OPERATION = 'guiProjectRemove';
export interface ProjectSelection { cwd: string; threadId?: string }

export function canMoveThreadToProject(state: ChatState, threadId: string) {
  const thread = state.selected?.id === threadId ? state.selected : state.threads.find(entry => entry.id === threadId);
  return state.ready && !state.sending && !state.workspaceBusy && !state.threadActionBusy
    && !state.projectActionBusy && !state.goalBusy && state.compacting !== threadId && !state.queueBusy
    && !state.sidebar.threads[threadId]?.running && thread?.status?.type !== 'active'
    && !thread?.turns?.some(turn => turn.status === 'inProgress') && !state.queue.threads[threadId]?.length
    && !state.approvals.some(event => event.params.threadId === threadId);
}

export function canSelectProject(state: ChatState) {
  const thread = state.selected;
  return state.ready && !state.sending && !state.workspaceBusy && !state.selectedArchived
    && !state.threadActionBusy && !state.projectActionBusy && !state.goalBusy && !state.compacting && !state.queueBusy
    && !(state.historyLoading && !thread?.turns)
    && !thread?.turns?.some(turn => turn.status === 'inProgress')
    && !(thread && (state.sidebar.threads[thread.id]?.running || state.queue.threads[thread.id]?.length
      || state.approvals.some(event => event.params.threadId === thread.id)));
}
