import { guiApi } from "../../../../../shared/conversation/api";
import { CONTINUE_MESSAGE } from "../../../../../shared/conversation/continuation";
import { resumedConversationSnapshot as conversation } from "./conversationSnapshot";
import { modelSelectionError } from "../../../../../shared/conversation/modelSelection";
import type { GuiState, Settings, Thread, Turn } from "../../../../../shared/conversation/types";

interface RetrySendHost {
  getSnapshot: () => GuiState;
  patch: (patch: Partial<GuiState>) => void;
  selection: (threadId: string) => Promise<Pick<Settings, "model" | "effort">>;
  catalogGuard: () => () => boolean;
  acceptTurn: (threadId: string, turn: Turn) => void;
  report: (error: unknown) => void;
  refresh: () => Promise<void>;
  flushQueue: () => void;
}

export async function sendCapacityRetry(host: RetrySendHost, threadId: string, canSend: () => boolean) {
  if (!canSend()) return false;
  const state = host.getSnapshot();
  const access = state.settings.access;
  const cwd = state.projectOverrides[threadId];
  const currentCatalog = host.catalogGuard();
  host.patch({ sending: true, pendingRequest: { threadId, startedAtMs: Date.now() } });
  try {
    const { model, effort } = await host.selection(threadId);
    if (modelSelectionError(host.getSnapshot().models, { model, effort })) return false;
    if (!canSend() || !currentCatalog()) return false;
    const { thread } = await guiApi.request<{ thread: Thread }>({ operation: "resume", threadId, access, cwd });
    if (!canSend() || !currentCatalog()) return false;
    const latest = host.getSnapshot();
    const current = conversation(thread, latest.conversations[threadId]);
    host.patch({ conversations: { ...latest.conversations, [threadId]: current } });
    if (current.activeTurn || !canSend()) return false;
    const { turn } = await guiApi.request<{ turn: Turn }>({ operation: "send", threadId,
      text: CONTINUE_MESSAGE, images: [], skills: [], model: model || undefined,
      effort: effort || undefined, access, cwd });
    host.acceptTurn(threadId, turn);
    void host.refresh();
    return true;
  } catch (error) { host.report(error); return false; }
  finally {
    host.patch({ sending: false, pendingRequest: undefined });
    host.flushQueue();
  }
}
