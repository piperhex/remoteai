import type { ReactNode } from 'react';
import { TurnRetryProvider } from '../../../../../shared/chat/TurnRetryContext';
import { failedTurnTarget, sameRetryTarget, type TurnRetryTarget } from '../../../../../shared/chat/turnRetry';
import { CONTINUE_MESSAGE } from './continuation';
import type { GuiController } from './controller';
import type { GuiState } from './types';

export function conversationRetryState(state: GuiState) {
  const current = state.selected ? state.conversations[state.selected] : undefined;
  return {
    target: failedTurnTarget(state.selected ?? undefined, current?.turns),
    disabled: state.connection !== 'ready' || state.sending || state.archived
      || state.modelCatalogLoading || state.modelSettingsLoading || Boolean(state.workspaceBusy || state.deleting)
      || Boolean(current?.activeTurn || state.pendingRequest)
      || Boolean(state.selected && (state.compacting === state.selected || state.queued[state.selected]?.length)),
  };
}

export async function retryConversation(controller: GuiController, target: TurnRetryTarget): Promise<boolean> {
  const current = conversationRetryState(controller.getSnapshot());
  if (current.disabled || !sameRetryTarget(current.target, target)) return false;
  controller.capacityRetry.cancel();
  return controller.send(CONTINUE_MESSAGE, []);
}

export function ConversationRetryProvider({ controller, state, children }: {
  controller: GuiController; state: GuiState; children: ReactNode;
}) {
  return <TurnRetryProvider {...conversationRetryState(state)}
    onRetry={target => retryConversation(controller, target)}>
    {children}
  </TurnRetryProvider>;
}
