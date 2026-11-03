import type { SidebarDragOptions } from '../../chat/groups/SidebarDrag';
import { canMoveThreadToProject } from '../projects';
import { threadPresentation } from '../sidebar';
import type { ChatController } from './controller';
import type { ChatState } from './types';

export function remoteSidebarDrag(state: ChatState, controller: ChatController): SidebarDragOptions {
  return {
    enabled: state.ready && !state.sending && !state.workspaceBusy && !state.projectActionBusy && !state.threadActionBusy,
    threadCwds: Object.fromEntries(state.threads.map(thread => [thread.id, threadPresentation(thread, state.sidebar).cwd])),
    canMoveThread: id => canMoveThreadToProject(state, id),
    moveThread: controller.moveThreadToProject,
  };
}
