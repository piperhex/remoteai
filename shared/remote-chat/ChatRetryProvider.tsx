import type { ReactNode } from 'react';
import { TurnRetryProvider, type TurnRetrySubmission } from '../chat/TurnRetryContext';
import { failedTurnTarget, sameRetryTarget, type TurnRetryTarget } from '../chat/turnRetry';
import { CONTINUE_MESSAGE } from './composerAction';
import type { ChatController } from './client/controller';
import type { ChatState } from './client/types';

export function chatRetryState(state: ChatState) {
  const threadId = state.selected?.id;
  return {
    target: failedTurnTarget(threadId, state.selected?.turns),
    releasedQueueItemIds: state.queue.cancelledIds ?? [],
    disabled: !state.ready || state.sending || state.settingsBusy || state.selectedArchived
      || state.queueBusy || Boolean(state.workspaceBusy || state.threadActionBusy || state.desktopOnly)
      || Boolean(threadId && (state.compacting === threadId || state.queue.threads[threadId]?.length)),
  };
}

export async function retryChat(controller: Pick<ChatController, 'snapshot' | 'send'>,
  target: TurnRetryTarget): Promise<TurnRetrySubmission> {
  const state = controller.snapshot();
  const current = chatRetryState(state);
  if (current.disabled || !sameRetryTarget(current.target, target)) return false;
  let queueItemId: string | undefined;
  const sent = await controller.send({ text: CONTINUE_MESSAGE, access: state.settings.access },
    id => { queueItemId = id; });
  return sent && queueItemId ? { queueItemId } : sent;
}

/** Native, web and the desktop remote workspace share the same retry guards. */
export function ChatRetryProvider({ controller, state, children }: {
  controller: ChatController; state: ChatState; children: ReactNode;
}) {
  return <TurnRetryProvider {...chatRetryState(state)} onRetry={target => retryChat(controller, target)}>
    {children}
  </TurnRetryProvider>;
}
