import { useSyncExternalStore } from 'react';
import { RunningConversations } from '../../../../../shared/conversation/RunningConversations';
import { localRunningConversations } from '../../../../../shared/conversation/runningConversationEntries';
import type { GuiState } from '../../../../../shared/conversation/types';
import { guiSidebar } from './sidebarBridge';

export function LocalRunningConversations({ state, onSelect, onOpen }: {
  state: GuiState; onSelect: (id: string) => void; onOpen: () => void;
}) {
  const sidebar = useSyncExternalStore(guiSidebar.subscribe, guiSidebar.snapshot);
  return <RunningConversations entries={localRunningConversations(state, sidebar)} selected={state.selected}
    disabled={state.sending} onSelect={onSelect} onOpen={onOpen} />;
}
