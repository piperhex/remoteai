import { guiText } from "../../i18n/guiText";
import { guiApi } from "./api";
import { conversation } from "./events";
import { withSentMessage } from "./sentMessages";
import type { GuiState, MessageInput, QueuedMessage, Settings, Thread, Turn } from "./types";

const MAX_QUEUED_MESSAGES = 100;
interface QueueHost {
  saved: () => Promise<void>;
  active: () => boolean;
  getSnapshot: () => GuiState;
  patch: (patch: Partial<GuiState>) => void;
  report: (error: unknown) => void;
  acceptTurn: (threadId: string, turn: Turn) => void;
  catalogGuard?: () => () => boolean;
  selection?: (threadId: string) => Pick<Settings, "model" | "effort">;
  generateTitle?: (thread: Thread, prompt: string) => Promise<void>;
}

export class MessageQueue {
  private pending = new Set<string>();
  constructor(private host: QueueHost) {}
  private list = (threadId: string) => this.host.getSnapshot().queued[threadId] ?? [];
  private update = (threadId: string, messages: QueuedMessage[]) => {
    this.host.patch({ queued: { ...this.host.getSnapshot().queued, [threadId]: messages } });
  };
  enqueue = (threadId: string, input: MessageInput,
    settings: Pick<Settings, "model" | "effort" | "access"> = this.host.getSnapshot().settings): boolean => {
    if (this.list(threadId).length >= MAX_QUEUED_MESSAGES) {
      this.host.report(guiText("待发送消息已满，请等待发送后再添加。"));
      return false;
    }
    this.update(threadId, [...this.list(threadId), { ...input, id: crypto.randomUUID(),
      model: settings.model, effort: settings.effort, access: settings.access }]);
    return true;
  };
  remove = (threadId: string, id: string) => {
    this.update(threadId, this.list(threadId).filter((item) => item.id !== id || item.busy));
    void this.flush(threadId);
  };
  hold = (threadId: string) => {
    this.update(threadId, this.list(threadId).map(item => item.busy ? item : { ...item,
      needsReview: true, error: guiText("保存结果尚未确认，请先检查待发送消息。") }));
  };
  move = (threadId: string, id: string, direction: "up" | "down") => {
    const messages = this.list(threadId);
    const index = messages.findIndex((item) => item.id === id);
    const targetIndex = index + (direction === "up" ? -1 : 1);
    const item = messages[index];
    const neighbor = messages[targetIndex];
    if (!item || !neighbor || item.busy || neighbor.busy) return;
    const reordered = [...messages];
    [reordered[index], reordered[targetIndex]] = [neighbor, item];
    this.update(threadId, reordered);
  };
  updateSettings = (threadId: string, settings: Partial<Pick<Settings, "model" | "effort" | "access">>) => {
    const messages = this.list(threadId);
    if (!messages.some((item) => !item.busy)) return;
    // Keep dispatched batches stable and apply changes only to this conversation's waiting messages.
    this.update(threadId, messages.map((item) => item.busy ? item : { ...item, ...settings }));
  };
  take = (threadId: string, id: string): MessageInput | undefined => {
    const item = this.list(threadId).find((message) => message.id === id);
    if (!item || item.busy) return;
    this.remove(threadId, id);
    return { text: item.text, images: item.images, skills: item.skills, attachments: item.attachments };
  };
  private markBusy = (threadId: string, ids: Set<string>, busy: boolean) => {
    this.update(threadId, this.list(threadId).map((item) => ids.has(item.id)
      ? { ...item, busy, ...(busy ? { error: undefined } : {}) } : item));
  };
  private fail = (threadId: string, ids: Set<string>, error: unknown, dispatched = true) => {
    this.host.report(error);
    this.update(threadId, this.list(threadId).map((item) => ids.has(item.id)
      ? { ...item, needsReview: dispatched,
        error: dispatched ? guiText("发送结果尚未确认，请查看聊天后重试。") : guiText("发送失败，请重试。") } : item));
  };
  private completeSend = (threadId: string, turnId: string, messages: QueuedMessage[], userMessageIndex: number) => {
    const state = this.host.getSnapshot();
    const current = state.conversations[threadId];
    if (!current) return;
    const ids = new Set(messages.map((item) => item.id));
    this.host.patch({
      queued: { ...state.queued, [threadId]: this.list(threadId).filter((item) => !ids.has(item.id)) },
      conversations: { ...state.conversations, [threadId]: { ...current,
        turns: current.turns.map((turn) => turn.id === turnId
          ? withSentMessage(turn, messages, userMessageIndex) : turn) } },
    });
  };
  private resume = async (threadId: string, message: QueuedMessage): Promise<boolean> => {
    const cwd = this.host.getSnapshot().projectOverrides[threadId];
    const { thread } = await guiApi.request<{ thread: Thread }>({
      operation: "resume", threadId, access: message.access, cwd });
    const state = this.host.getSnapshot();
    if (!this.host.active() || state.connection !== "ready" || state.conversations[threadId]?.activeTurn) return false;
    const current = conversation(thread, state.conversations[threadId]);
    this.host.patch({ conversations: { ...state.conversations, [threadId]: current } });
    return !current.activeTurn;
  };
  flush = async (threadId: string, retry = false): Promise<void> => {
    const state = this.host.getSnapshot();
    const messages = this.list(threadId);
    if (!this.host.active() || state.modelCatalogLoading || state.workspaceBusy
      || state.connection !== "ready" || state.sending
      || state.compacting === threadId
      || this.pending.has(threadId)
      || state.conversations[threadId]?.activeTurn || !messages.length
      || (!retry && messages.some(item => item.needsReview))) return;
    this.pending.add(threadId);
    const ids = new Set(messages.map((item) => item.id));
    this.markBusy(threadId, ids, true);
    const currentCatalog = this.host.catalogGuard?.() ?? (() => true);
    let sent = false;
    let dispatched = false;
    try {
      await this.host.saved();
      if (!await this.resume(threadId, messages[0]) || !currentCatalog()) return;
      const thread = this.host.getSnapshot().conversations[threadId]?.thread;
      dispatched = true;
      const { turn } = await guiApi.request<{ turn: Turn }>({ operation: "sendBatch", threadId,
        cwd: this.host.getSnapshot().projectOverrides[threadId],
        messages: messages.map(({ text, images, skills, attachments, transferMode }) => ({ text, images, skills,
          ...(transferMode ? { transferMode } : {}),
          ...(attachments?.length ? { attachments: attachments } : {}) })),
        model: messages[0].model || undefined, effort: messages[0].effort || undefined, access: messages[0].access });
      this.host.acceptTurn(threadId, turn);
      this.completeSend(threadId, turn.id, messages, 0);
      if (thread) void this.host.generateTitle?.(thread, messages.map((message) => message.text).join('\n'));
      sent = true;
    } catch (error) { this.fail(threadId, ids, error, dispatched); }
    finally {
      this.pending.delete(threadId); this.markBusy(threadId, ids, false);
      if (!currentCatalog()) {
        const selection = this.host.selection?.(threadId);
        if (selection) this.updateSettings(threadId, selection);
        void this.flush(threadId);
      }
    }
    if (sent) void this.flush(threadId);
  };
  steer = async (threadId: string, id: string) => {
    const state = this.host.getSnapshot();
    const turnId = state.conversations[threadId]?.activeTurn;
    const item = this.list(threadId).find((entry) => entry.id === id);
    if (!this.host.active() || state.connection !== "ready" || !turnId || !item || item.busy
      || this.pending.has(threadId)) return;
    this.pending.add(threadId);
    const ids = new Set([id]);
    const userMessageIndex = state.conversations[threadId].turns.find((turn) => turn.id === turnId)
      ?.items.filter((entry) => entry.type === "userMessage").length ?? 0;
    this.markBusy(threadId, ids, true);
    try {
      await this.host.saved();
      await guiApi.request({ operation: "steer", threadId, turnId,
        ...(item.transferMode ? { transferMode: item.transferMode } : {}),
        text: item.text, images: item.images, skills: item.skills,
        ...(item.attachments?.length ? { attachments: item.attachments } : {}) });
      this.completeSend(threadId, turnId, [item], userMessageIndex);
    } catch (error) { this.fail(threadId, ids, error); }
    finally { this.pending.delete(threadId); this.markBusy(threadId, ids, false); }
    void this.flush(threadId);
  };
}
