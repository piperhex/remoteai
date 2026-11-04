// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "../../../../../shared/conversation/api";
import { GuiController } from "./controller";
import type { GuiEvent, Thread, Turn } from "../../../../../shared/conversation/types";

vi.mock("../../../../../shared/conversation/api", () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn(), respond: vi.fn() } }));
const source: Thread = { id: "source", cwd: "D:/project", preview: "original", updatedAt: 1, turns: [
  { id: "old", status: "completed", items: [{ id: "old-user", type: "userMessage",
    content: [{ type: "text", text: "early context" }] }] },
  { id: "last", status: "completed", items: [{ id: "user", type: "userMessage",
    content: [{ type: "text", text: "original" }] }, { id: "answer", type: "agentMessage", text: "old answer" }] },
] };
const rolledBack: Thread = { ...source, turns: [source.turns![0]] };
const turn: Turn = { id: "new", status: "inProgress", items: [{ id: "edited", type: "userMessage",
  content: [{ type: "text", text: "edited" }] }] };
const edit = { threadId: "source", turnId: "last", itemId: "user", text: "edited" };
let receive: (event: GuiEvent) => void;

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockImplementation(async (callback) => { receive = callback; return vi.fn<() => void>(); });
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "list" || request.operation === "models") return { data: [], nextCursor: null };
    if (request.operation === "editMessage") return { thread: rolledBack, turn };
    if (request.operation === "deleteMessage") return { thread: rolledBack };
    return { thread: source };
  });
});
async function setup() {
  const controller = new GuiController();
  await controller.connect(); await controller.select(source.id);
  return controller;
}

it('deletes the last user message and all subsequent replies without sending another turn', async () => {
  const controller = await setup();
  const target = { threadId: source.id, turnId: 'last', itemId: 'user' };
  expect(await controller.messageEditor.remove({ ...target, itemId: 'old-user' })).toBe(false);
  expect(await controller.messageEditor.remove(target)).toBe(true);
  expect(guiApi.request).toHaveBeenCalledWith({ operation: 'deleteMessage', ...target,
    access: controller.getSnapshot().settings.access });
  expect(controller.getSnapshot().conversations.source.turns.map(entry => entry.id)).toEqual(['old']);
  expect(controller.getSnapshot().conversations.source.activeTurn).toBeNull();
  expect(controller.getSnapshot().selected).toBe(source.id);
  expect(controller.messageEditor.recoveredDrafts.size).toBe(0);
  controller.dispose();
});

it('keeps history and allows retry if deleting fails', async () => {
  const controller = await setup();
  const before = controller.getSnapshot().conversations;
  vi.mocked(guiApi.request).mockRejectedValue(new Error('删除失败'));
  expect(await controller.messageEditor.remove(edit)).toBe(false);
  expect(controller.getSnapshot().conversations).toBe(before);
  expect(controller.getSnapshot()).toMatchObject({ sending: false, error: '删除失败' });
  controller.dispose();
});

it("replaces the latest turn in the same conversation and sends current settings", async () => {
  const controller = await setup();
  controller.settings({ model: "model", effort: "high", access: "workspace-write" });
  controller.setProject("D:/override");
  expect(await controller.messageEditor.submit(edit)).toBe(true);
  expect(guiApi.request).toHaveBeenCalledWith({ operation: "editMessage", ...edit,
    model: "model", effort: "high", access: "workspace-write", cwd: "D:/override" });
  const state = controller.getSnapshot();
  expect(state.selected).toBe("source");
  expect(Object.keys(state.conversations)).toEqual(["source"]);
  expect(state.conversations.source.turns.map((entry) => entry.id)).toEqual(["old", "new"]);
  expect(state.conversations.source.activeTurn).toBe("new");
  expect(state.sending).toBe(false);
  controller.dispose();
});

it("preserves completed streaming events that arrive before the acknowledgement", async () => {
  const controller = await setup();
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation !== "editMessage") return original(request);
    receive({ method: "thread/started", params: { thread: rolledBack } });
    receive({ method: "turn/started", params: { threadId: rolledBack.id, turn } });
    receive({ method: "turn/completed", params: { threadId: rolledBack.id, turn: { ...turn,
      status: "completed", items: [...turn.items, { id: "reply", type: "agentMessage", text: "new reply" }] } } });
    return { thread: rolledBack, turn };
  });
  expect(await controller.messageEditor.submit(edit)).toBe(true);
  expect(controller.getSnapshot().conversations.source.activeTurn).toBeNull();
  expect(controller.getSnapshot().conversations.source.turns.at(-1)?.items.at(-1)?.text).toBe("new reply");
  controller.dispose();
});

it("keeps selection and source history on failure", async () => {
  const controller = await setup();
  const before = controller.getSnapshot().conversations;
  vi.mocked(guiApi.request).mockRejectedValue(new Error("暂时无法发送"));
  expect(await controller.messageEditor.submit(edit)).toBe(false);
  expect(controller.getSnapshot()).toMatchObject({ selected: "source", sending: false, error: "暂时无法发送" });
  expect(controller.getSnapshot().conversations).toBe(before);
  controller.dispose();
});

it("resends an immediately stopped first message without creating another conversation", async () => {
  const stopped: Thread = { ...source, turns: [{ ...source.turns![1], status: "interrupted",
    items: [source.turns![1].items[0]] }] };
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "read") return { thread: stopped };
    if (request.operation === "list") return { data: [stopped], nextCursor: null };
    if (request.operation === "editMessage") return { thread: { ...stopped, turns: [] }, turn };
    return original(request);
  });
  const controller = await setup();
  controller.pin(source.id);
  expect(await controller.messageEditor.submit(edit)).toBe(true);
  const state = controller.getSnapshot();
  expect(state.selected).toBe(source.id);
  expect(state.threads.map((thread) => thread.id)).toEqual([source.id]);
  expect(state.pins).toEqual([source.id]);
  expect(state.conversations.source.turns.map((entry) => entry.id)).toEqual([turn.id]);
  controller.dispose();
});

it("removes interrupted continuations together with the edited message", async () => {
  const controller = await setup();
  receive({ method: "turn/completed", params: { threadId: source.id,
    turn: { id: "continuation", status: "completed", items: [] } } });
  expect(await controller.messageEditor.submit(edit)).toBe(true);
  expect(controller.getSnapshot().conversations.source.turns.map((entry) => entry.id)).toEqual(["old", "new"]);
  controller.dispose();
});

it("reconciles a successful rollback and saves the draft when resending fails", async () => {
  const controller = await setup();
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  vi.mocked(guiApi.request).mockImplementation(async (request) => request.operation === "editMessage"
    ? { thread: rolledBack, error: "Send failed" } : original(request));
  expect(await controller.messageEditor.submit(edit)).toBe(false);
  const state = controller.getSnapshot();
  expect(state.conversations.source.turns.map((entry) => entry.id)).toEqual(["old"]);
  expect(state.conversations.source.activeTurn).toBeNull();
  expect(state.error).toContain("已放回输入框");
  expect(controller.messageEditor.recoveredDrafts.get(source.id)?.text).toBe(edit.text);
  controller.dispose();
});

it("rejects stale messages, empty edits, active turns, and duplicate submissions", async () => {
  const controller = await setup();
  vi.mocked(guiApi.request).mockClear();
  expect(await controller.messageEditor.submit({ ...edit, itemId: "old-user" })).toBe(false);
  expect(await controller.messageEditor.submit({ ...edit, text: "  " })).toBe(false);
  receive({ method: "turn/started", params: { threadId: source.id, turn } });
  expect(await controller.messageEditor.submit(edit)).toBe(false);
  expect(guiApi.request).not.toHaveBeenCalled();
  controller.dispose();
  const fresh = await setup();
  let finish!: (value: unknown) => void;
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  vi.mocked(guiApi.request).mockImplementation((request) => request.operation === "editMessage"
    ? new Promise((resolve) => { finish = resolve; }) : original(request));
  const sending = fresh.messageEditor.submit(edit);
  expect(await fresh.messageEditor.submit(edit)).toBe(false);
  fresh.newConversation();
  finish({ thread: rolledBack, turn });
  expect(await sending).toBe(true);
  expect(fresh.getSnapshot().selected).toBeNull();
  fresh.dispose();
});
