import { guiApi } from "./api";
import { conversation } from "./events";
import { isThreadRunning } from "./threadRunning";
import type { ThreadModelSettings } from "./threadModelSettings";
import type { GuiState, Thread, Turn } from "./types";

export function canForkConversation(state: GuiState, threadId = state.selected): boolean {
  return Boolean(threadId && state.connection === "ready" && !state.forking
    && !state.sending && !state.deleting && !state.workspaceBusy && !state.modelSettingsLoading
    && !state.archived && state.compacting !== threadId);
}

export function canForkLatestConversation(state: GuiState, thread: Thread): boolean {
  return canForkConversation(state, thread.id) && !isThreadRunning(state, thread);
}

interface ForkHost {
  getSnapshot: () => GuiState;
  patch: (patch: Partial<GuiState>) => void;
  report: (error: unknown) => void;
  selectionGeneration: () => number;
  modelSettings: Pick<ThreadModelSettings, "ready" | "created">;
  select: (threadId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

async function latestForkTurn(host: ForkHost, threadId: string): Promise<Turn> {
  // List entries and cached conversations can omit turns or lag behind another client.
  const { thread } = await guiApi.request<{ thread: Thread }>({ operation: "read", threadId });
  const turn = thread.turns?.at(-1);
  if (isThreadRunning(host.getSnapshot(), thread) || turn?.status === "inProgress") {
    throw new Error("请等待当前回复完成后，再创建分支。");
  }
  if (!turn) throw new Error("这条对话还没有可用于创建分支的消息。");
  return turn;
}

export async function forkGuiConversation(host: ForkHost, threadId: string, turnId?: string): Promise<boolean> {
  const state = host.getSnapshot();
  if (!canForkConversation(state, threadId)) return false;
  const turn = state.conversations[threadId]?.turns.find((entry) => entry.id === turnId);
  if (turnId !== undefined && (state.selected !== threadId || !turn || turn.status === "inProgress")) return false;
  const generation = host.selectionGeneration();
  host.patch({ forking: threadId, error: "" });
  try {
    const selection = state.selected === threadId ? state.settings : await host.modelSettings.ready(threadId);
    const boundary = turn ?? await latestForkTurn(host, threadId);
    if (!canForkConversation({ ...host.getSnapshot(), forking: undefined }, threadId)) return false;
    const { thread } = await guiApi.request<{ thread: Thread }>({ operation: "fork", threadId,
      turnId: boundary.id, access: state.settings.access, cwd: state.projectOverrides[threadId] });
    host.patch({ conversations: { ...host.getSnapshot().conversations, [thread.id]: conversation(thread) },
      threads: [thread, ...host.getSnapshot().threads.filter((entry) => entry.id !== thread.id)] });
    host.modelSettings.created(thread.id, { model: selection.model, effort: selection.effort });
    if (generation === host.selectionGeneration()) {
      host.patch({ archived: false, search: "" });
      await host.select(thread.id);
    }
    void host.refresh();
    return true;
  } catch (error) { host.report(error); return false; }
  finally { host.patch({ forking: undefined }); }
}
