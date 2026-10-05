import type { Conversation, GuiEvent, GuiState, Item, Thread, Turn } from "./types";
import { completeTurnTiming, restoreTurnTiming } from "./turnTiming";
import { cachedTurnDetails } from "./turnDetailsStorage";
import { restoreModelChanges } from "./modelChangeHistory";
import { restoreProcessing, trackProcessing } from "./processing";
import { trackProcessingApproval } from "./processingApprovals";
import { mergeMessageItems } from "./sentMessages";
import { recordRequestError, restoreRequestErrors } from "./turnRequestErrors";

export function conversation(thread: Thread, previous?: Conversation): Conversation {
  const previousTurns = new Map(previous?.turns.map((turn) => [turn.id, turn]));
  const cached = cachedTurnDetails(thread.id);
  const turns = (thread.turns ?? []).map((turn) => {
    const previousTurn = previousTurns.get(turn.id);
    return restoreRequestErrors({ diff: previousTurn?.diff ?? cached.get(turn.id)?.diff,
      plan: previousTurn?.plan ?? cached.get(turn.id)?.plan,
      planExplanation: previousTurn?.planExplanation ?? cached.get(turn.id)?.planExplanation,
      retryError: previousTurn?.retryError,
      ...restoreTurnTiming(turn, previousTurn),
      items: mergeMessageItems(previousTurn?.items ?? [],
        restoreModelChanges(turn.items ?? [], cached.get(turn.id)?.modelChanges)) }, previousTurn);
  });
  const active = turns.find((turn) => turn.status === "inProgress");
  return { thread, turns, activeTurn: active?.id ?? null,
    ...(active ? { processing: restoreProcessing(active, previous?.processing) } : {}),
    tokens: previous?.tokens ?? 0, tokenUsage: previous?.tokenUsage, error: "" };
}

function updateTurn(value: Conversation, id: string, update: (turn: Turn) => Turn): Conversation {
  const turns = [...value.turns];
  const index = turns.findIndex((turn) => turn.id === id);
  const next = update(turns[index] ?? { id, status: "inProgress", items: [] });
  if (index === -1) turns.push(next);
  else turns[index] = next;
  return { ...value, turns };
}

function mergeTurn(previous: Turn, incoming: Turn): Turn {
  // Lifecycle notifications can contain only a summary. Omitted items are not deletions.
  return restoreRequestErrors({ ...previous, ...restoreTurnTiming(incoming, previous),
    items: mergeMessageItems(previous.items, incoming.items ?? []) });
}

function updateItem(value: Conversation, event: GuiEvent, update: (item: Item) => Item): Conversation {
  const { turnId, itemId, item } = event.params;
  const id = itemId ?? item?.id;
  if (!turnId || !id) return value;
  return updateTurn(value, turnId, (turn) => {
    const items = [...turn.items];
    const index = items.findIndex((entry) => entry.id === id);
    const next = update(items[index] ?? { id, type: "agentMessage" });
    if (index === -1) items.push(next);
    else items[index] = next;
    return { ...turn, items };
  });
}

function applyDelta(value: Conversation, event: GuiEvent): Conversation {
  const delta = event.params.delta ?? "";
  return updateItem(value, event, (item) => {
    if (event.method === "item/commandExecution/outputDelta") {
      return { ...item, type: "commandExecution", aggregatedOutput: (item.aggregatedOutput ?? "") + delta };
    }
    if (event.method === "item/fileChange/outputDelta") {
      return { ...item, type: "fileChange", aggregatedOutput: (item.aggregatedOutput ?? "") + delta };
    }
    if (event.method.startsWith("item/reasoning/")) {
      const key = event.method.includes("summary") ? "summary" : "content";
      const parts = [...((item[key] as string[] | undefined) ?? [])];
      const index = event.params.summaryIndex ?? event.params.contentIndex ?? 0;
      parts[index] = (parts[index] ?? "") + delta;
      return { ...item, type: "reasoning", [key]: parts };
    }
    return { ...item, type: event.method === "item/plan/delta" ? "plan" : "agentMessage",
      text: (item.text ?? "") + delta };
  });
}

const TEXT_DELTAS = new Set(["item/agentMessage/delta", "item/plan/delta", "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta", "item/reasoning/summaryTextDelta", "item/reasoning/textDelta"]);

function updateTurnDetails(value: Conversation, event: GuiEvent): Conversation {
  const id = event.params.turnId ?? value.activeTurn;
  if (!id) return value;
  return updateTurn(value, id, (turn) => event.method === "turn/diff/updated"
    ? { ...turn, diff: event.params.diff ?? "" }
    : { ...turn, plan: event.params.plan ?? [], planExplanation: event.params.explanation });
}

function reduceConversationContent(value: Conversation, event: GuiEvent): Conversation {
  const { method, params } = event;
  if (method === "turn/started" && params.turn) {
    return { ...updateTurn(value, params.turn.id, (old) => mergeTurn(old, params.turn!)),
      activeTurn: params.turn.id, error: "" };
  }
  if (method === "turn/completed" && params.turn) {
    return { ...updateTurn(value, params.turn.id, (old) => completeTurnTiming(mergeTurn(old, params.turn!))),
      activeTurn: value.activeTurn === params.turn.id ? null : value.activeTurn,
      error: "" };
  }
  if ((method === "item/started" || method === "item/completed") && params.item) {
    if (!params.turnId) return value;
    const updated = updateTurn(value, params.turnId, (turn) => ({ ...turn,
      items: mergeMessageItems(turn.items, [params.item!]) }));
    if (params.item.type === "userMessage" && !value.thread.preview) {
      const content = params.item.content?.filter((part) => typeof part === "object" && part.type === "text") ?? [];
      const preview = content.map((part) => typeof part === "object" ? part.text : "").join(" ");
      return { ...updated, thread: { ...updated.thread, preview } };
    }
    return updated;
  }
  if (TEXT_DELTAS.has(method)) return applyDelta(value, event);
  if (method === "item/mcpToolCall/progress") return updateItem(value, event, (item) => ({ ...item,
    type: "mcpToolCall", progress: [...(item.progress ?? []), params.message ?? ""].slice(-50) }));
  if (method === "turn/diff/updated" || method === "turn/plan/updated") return updateTurnDetails(value, event);
  if (method === "thread/tokenUsage/updated" && params.tokenUsage) return {
    ...value, tokens: params.tokenUsage.total.totalTokens, tokenUsage: params.tokenUsage,
  };
  if (method === "error") {
    const turnId = params.turnId ?? value.activeTurn;
    if (!turnId) return value;
    const error = params.error ?? { message: "" };
    return updateTurn(value, turnId, (turn) => recordRequestError(turn, error, Boolean(params.willRetry)));
  }
  return value;
}

export function reduceConversation(value: Conversation, event: GuiEvent): Conversation {
  return trackProcessing(reduceConversationContent(value, event), event);
}

function syncThreadPreview(state: GuiState, thread: Thread): Thread[] {
  const update = (entry: Thread) => ({ ...entry, preview: thread.preview,
    cwd: state.projectOverrides[entry.id] ?? entry.cwd });
  if (state.threads.some((entry) => entry.id === thread.id)) {
    return state.threads.map((entry) => entry.id === thread.id ? update(entry) : entry);
  }
  if (state.archived || state.search) return state.threads;
  return [update(thread), ...state.threads];
}

export function reduceEvent(state: GuiState, event: GuiEvent): GuiState {
  if (event.method === 'thread/name/updated' && event.params.threadId && event.params.threadName !== undefined) {
    const { threadId, threadName: name } = event.params;
    const current = state.conversations[threadId];
    return { ...state, threads: state.threads.map((thread) => thread.id === threadId ? { ...thread, name } : thread),
      conversations: current ? { ...state.conversations,
        [threadId]: { ...current, thread: { ...current.thread, name } } } : state.conversations };
  }
  if (event.method === "computerUse/setup") {
    return { ...state, computerUseSetup: event.params.computerUseSetup };
  }
  if (event.method === "unattended/setup") {
    return { ...state, unattendedSetup: event.params.unattendedSetup };
  }
  state = trackProcessingApproval(state, event);
  if (event.params.threadId && ["thread/goal/updated", "thread/goal/cleared"].includes(event.method)) {
    return { ...state, goals: { ...state.goals, [event.params.threadId]: event.params.goal ?? null } };
  }
  if (event.method === "connection/closed") {
    const conversations = Object.fromEntries(Object.entries(state.conversations)
      .map(([id, value]) => [id, { ...value, activeTurn: null, processing: undefined }]));
    return { ...state, connection: "offline", approvals: [], conversations, sending: false, compacting: undefined,
      pendingRequest: undefined, error: "Codex 已断开连接。重新连接后可以继续对话。" };
  }
  if (event.id != null) return { ...state,
    approvals: [...state.approvals.filter((entry) => entry.id !== event.id), event] };
  if (event.method === "serverRequest/resolved") {
    return { ...state, approvals: state.approvals.filter((entry) => entry.id !== event.params.requestId) };
  }
  const id = event.params.threadId ?? event.params.thread?.id;
  if (!id) return state;
  const thread = event.params.thread;
  const existing = state.conversations[id];
  if (!existing && !thread) return state;
  const value = reduceConversation(existing ?? conversation(thread!), event);
  const threads = value.thread.preview && value.thread.preview !== existing?.thread.preview
    ? syncThreadPreview(state, value.thread) : state.threads;
  const approvals = event.method === "turn/completed"
    ? state.approvals.filter((entry) => entry.params.turnId !== event.params.turn?.id) : state.approvals;
  const compactFinished = event.method === "turn/completed" || (event.method === "error" && !event.params.willRetry);
  const compacting = state.compacting === id && compactFinished ? undefined : state.compacting;
  const turnAcknowledged = event.method === "turn/started" || event.method === "turn/completed";
  const pendingRequest = turnAcknowledged && state.pendingRequest?.threadId === id ? undefined : state.pendingRequest;
  return { ...state, threads, approvals, compacting, pendingRequest,
    conversations: { ...state.conversations, [id]: value } };
}
