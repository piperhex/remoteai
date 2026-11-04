import { uiText } from "../../../../../shared/localization/uiText";
import type { ModelSettingsSnapshot } from "./threadModelSettings";
import type { GuiState, Item } from "../../../../../shared/conversation/types";
import { rememberTurnDetails } from "../../../../../shared/conversation/turnDetailsStorage";

export interface PendingModelChange {
  turnId: string;
  fromModel: string;
  toModel: string;
  modelChanged: boolean;
}

/** Only a runtime acknowledgement confirms a live change; saving preferences is insufficient. */
export function modelChangeItem(snapshot: ModelSettingsSnapshot, change: PendingModelChange): Item {
  const item: Item = { id: `model-change-${snapshot.threadId}-${snapshot.revision}`,
    type: "modelChange", status: "completed", success: snapshot.liveUpdate !== "failed" };
  if (snapshot.liveUpdate === "failed") return { ...item, text: uiText("client.conversation.couldNotUpdateTheModelSettingsForTheCurrentTask"),
    summary: [uiText("client.conversation.settingsSavedUpdateCodexAndRetryOrStopGenerationBefore")] };
  const text = change.modelChanged ? uiText("client.conversation.modelChangedFromTo", { value1: change.fromModel, value2: change.toModel }) : uiText("client.conversation.reasoningEffortUpdated");
  const timing = snapshot.liveUpdate === "applied" ? uiText("client.conversation.takesEffectWithTheNextRequest") : uiText("client.conversation.takesEffectWithTheNextConversationTurn");
  return { ...item, text, summary: [timing + (change.modelChanged ? uiText("client.conversation.switchingModelsDuringATaskMaySlowTheResponse") : "")] };
}

export function appendModelChange(state: GuiState, snapshot: ModelSettingsSnapshot,
  change: PendingModelChange): Partial<GuiState> {
  const threadId = snapshot.threadId;
  const current = threadId ? state.conversations[threadId] : undefined;
  if (!threadId || !current) return {};
  const item = modelChangeItem(snapshot, change);
  const conversation = { ...current, turns: current.turns.map((turn) => turn.id === change.turnId
    ? { ...turn, items: [...turn.items.filter((entry) => entry.id !== item.id), item] } : turn) };
  rememberTurnDetails(conversation, change.turnId);
  return { conversations: { ...state.conversations, [threadId]: conversation } };
}
