import { useSyncExternalStore } from 'react';
import { RunningConversations } from '../../../../../shared/conversation/RunningConversations';
import { localRunningConversations } from '../../../../../shared/conversation/runningConversationEntries';
import type { GuiState } from '../../../../../shared/conversation/types';
import { guiSidebar } from './sidebarBridge';
import { loadConversationMetrics } from '../../api/conversationMetrics';

export function LocalRunningConversations({ state, visible, onSelect, onOpen }: {
  state: GuiState; visible: boolean; onSelect: (id: string) => void; onOpen: () => void;
}) {
  const sidebar = useSyncExternalStore(guiSidebar.subscribe, guiSidebar.snapshot);
  return <RunningConversations entries={localRunningConversations(state, sidebar)} selected={state.selected}
    readMetrics={visible && state.connection === 'ready' ? loadConversationMetrics : undefined}
    disabled={state.sending} onSelect={onSelect} onOpen={onOpen} />;
}
