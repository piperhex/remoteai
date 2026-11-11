import { uiText } from "../../../../../shared/localization/uiText";
import { guiApi } from "../../../../../shared/conversation/api";
import { modelSelectionError } from "../../../../../shared/conversation/modelSelection";
import { resumedConversationSnapshot as conversation } from "./conversationSnapshot";
import type { ThreadGoal } from "../../../../../shared/conversation/goalTypes";
import type { GuiState, Thread } from "../../../../../shared/conversation/types";

interface GoalHost {
  getSnapshot: () => GuiState;
  patch: (patch: Partial<GuiState>) => void;
  report: (error: unknown) => void;
}

export class GuiGoals {
  constructor(private host: GoalHost) {}
  private update = (threadId: string, goal: ThreadGoal | null) => {
    const state = this.host.getSnapshot();
    this.host.patch({ goals: { ...state.goals, [threadId]: goal },
      goalErrors: { ...state.goalErrors, [threadId]: "" } });
  };
  load = async (threadId: string) => {
    const before = this.host.getSnapshot().goals?.[threadId];
    try {
      const { goal } = await guiApi.request<{ goal: ThreadGoal | null }>({ operation: "goalGet", threadId });
      if (this.host.getSnapshot().goals?.[threadId] === before) this.update(threadId, goal);
    } catch {
      const state = this.host.getSnapshot();
      this.host.patch({ goalErrors: { ...state.goalErrors,
        [threadId]: uiText("client.composer.couldNotLoadTheGoalPleaseRetryOrUpdateCodex") } });
    }
  };
  private prepare = async (state: GuiState) => {
    const { thread } = await guiApi.request<{ thread: Thread }>(state.selected
      ? { operation: "resume", threadId: state.selected, access: state.settings.access,
        cwd: state.projectOverrides[state.selected] }
      : { operation: "start", cwd: state.settings.cwd || undefined,
        model: state.settings.model || undefined, access: state.settings.access });
    const latest = this.host.getSnapshot();
    this.host.patch({ selected: latest.selected === state.selected ? thread.id : latest.selected,
      conversations: { ...latest.conversations, [thread.id]: conversation(thread, latest.conversations[thread.id]) } });
    return thread.id;
  };
  set = async (options: { objective?: string; status: "active" | "paused"; threadId?: string }) => {
    const state = this.host.getSnapshot();
    const id = options.threadId ?? state.selected;
    if (options.status === "active" && modelSelectionError(state.models, state.settings)) return false;
    if (state.modelCatalogLoading || state.modelSettingsLoading || state.workspaceBusy
      || state.connection !== "ready" || state.sending || state.goalBusy || state.archived
      || state.deleting || state.compacting || (!id && !options.objective?.trim())) return false;
    if (options.status === "active" && id && (state.conversations[id]?.activeTurn
      || state.queued[id]?.length || state.approvals.some((event) => event.params.threadId === id))) return false;
    this.host.patch({ goalBusy: true, sending: true });
    try {
      const threadId = options.status === "paused" && id ? id : await this.prepare({ ...state, selected: id });
      const before = this.host.getSnapshot().goals?.[threadId];
      const { goal } = await guiApi.request<{ goal: ThreadGoal }>({ operation: "goalSet", threadId,
        objective: options.objective?.trim(), status: options.status });
      if (this.host.getSnapshot().goals?.[threadId] === before) this.update(threadId, goal);
      return true;
    } catch {
      this.host.report(uiText("client.composer.couldNotUpdateTheGoalPleaseRetryOrUpdateCodex"));
      return false;
    } finally { this.host.patch({ goalBusy: false, sending: false }); }
  };
  clear = async (threadId: string) => {
    const state = this.host.getSnapshot();
    if (state.goalBusy || state.sending || state.connection !== "ready" || state.archived) return false;
    this.host.patch({ goalBusy: true });
    try {
      await guiApi.request({ operation: "goalClear", threadId });
      this.update(threadId, null);
      return true;
    } catch { this.host.report(uiText("client.errors.couldNotRemoveTheGoalPleaseTryAgainLater")); return false; }
    finally { this.host.patch({ goalBusy: false }); }
  };
}
