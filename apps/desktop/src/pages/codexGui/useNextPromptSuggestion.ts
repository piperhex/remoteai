import { guiApi } from '../../../../../shared/conversation/api';
import type { GuiState } from '../../../../../shared/conversation/types';
import { promptSuggestionTarget, type RequestPromptSuggestion } from '../../../../../shared/chat/nextPromptSuggestion';
import { usePromptSuggestion } from '../../../../../shared/chat/usePromptSuggestion';

const request: RequestPromptSuggestion = target => guiApi.request({ operation: 'suggestNextPrompt', ...target });

export function useNextPromptSuggestion(state: GuiState, options: { active: boolean; blocked: boolean }) {
  const current = state.selected ? state.conversations[state.selected] : undefined;
  const target = promptSuggestionTarget(current ? { id: current.thread.id, turns: current.turns } : null,
    state.models.find(model => model.model === state.settings.model));
  const visible = options.active && !state.sending && !state.archived && !state.compacting && !current?.activeTurn
    && !state.goals?.[state.selected ?? ''] && !state.queued[state.selected ?? '']?.length
    && !state.approvals.some(event => event.params.threadId === state.selected);
  const enabled = visible && state.connection === 'ready' && !state.loading && !state.workspaceBusy
    && !state.modelSettingsLoading && !state.modelCatalogLoading && !current?.error;
  return usePromptSuggestion({ target, enabled, visible, request }, options.blocked);
}
