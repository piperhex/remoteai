// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "./api";
import { GuiController } from "./controller";
import type { Thread } from "./types";

vi.mock("./api", () => ({ guiApi: {
  connect: vi.fn(), request: vi.fn(), subscribe: vi.fn(), respond: vi.fn(),
} }));
const source: Thread = { id: "source", cwd: "D:/project", preview: "original", updatedAt: 1,
  turns: ["first", "last"].map((id) => ({ id, status: "completed", items: [
    { id: `${id}-answer`, type: "agentMessage", text: id },
  ] })) };
const fork: Thread = { ...source, id: "fork", turns: source.turns!.slice(0, 1) };

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockResolvedValue(vi.fn());
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "list" || request.operation === "models") return { data: [], nextCursor: null };
    if (request.operation === "fork") return { thread: fork };
    return { thread: request.operation === "read" && request.threadId === fork.id ? fork : source };
  });
});

async function setup() {
  const controller = new GuiController();
  await controller.connect(); await controller.select(source.id);
  return controller;
}

it("opens the fork at the requested turn and preserves the source and model choice", async () => {
  const controller = await setup();
  controller.settings({ model: "model", effort: "high", access: "workspace-write" });
  controller.setProject("D:/override");
  const original = controller.getSnapshot().conversations.source;
  expect(await controller.forkConversation(source.id, "first")).toBe(true);
  expect(guiApi.request).toHaveBeenCalledWith({ operation: "fork", threadId: source.id, turnId: "first",
    access: "workspace-write", cwd: "D:/override" });
  const state = controller.getSnapshot();
  expect(state.selected).toBe(fork.id);
  expect(state.conversations.source).toBe(original);
  expect(state.conversations.fork.turns.map((turn) => turn.id)).toEqual(["first"]);
  expect(state.settings).toMatchObject({ model: "model", effort: "high" });
  expect(state.forking).toBeUndefined();
  controller.dispose();
});

it("rejects duplicate clicks and does not steal selection after navigating away", async () => {
  const controller = await setup();
  let finish!: (response: { thread: Thread }) => void;
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  vi.mocked(guiApi.request).mockImplementation((request) => request.operation === "fork"
    ? new Promise((resolve) => { finish = resolve; }) : original(request));
  const pending = controller.forkConversation(source.id, "first");
  expect(await controller.forkConversation(source.id, "first")).toBe(false);
  controller.newConversation();
  finish({ thread: fork });
  expect(await pending).toBe(true);
  expect(controller.getSnapshot().selected).toBeNull();
  expect(controller.getSnapshot().conversations.fork.thread.id).toBe(fork.id);
  controller.dispose();
});

it("keeps the original conversation on failure and permits retry", async () => {
  const controller = await setup();
  const original = controller.getSnapshot().conversations.source;
  vi.mocked(guiApi.request).mockRejectedValueOnce(new Error("暂时无法创建新聊天"));
  expect(await controller.forkConversation(source.id, "first")).toBe(false);
  expect(controller.getSnapshot()).toMatchObject({ selected: source.id, error: "暂时无法创建新聊天" });
  expect(controller.getSnapshot().conversations.source).toBe(original);
  expect(controller.getSnapshot().forking).toBeUndefined();
  expect(await controller.forkConversation(source.id, "first")).toBe(true);
  controller.dispose();
});

it("rejects missing turns and turns that are still running", async () => {
  const controller = await setup();
  expect(await controller.forkConversation(source.id, "missing")).toBe(false);
  vi.mocked(guiApi.request).mockResolvedValue({ thread: { ...source,
    turns: [{ ...source.turns![0], status: "inProgress" }] } });
  await controller.select(source.id);
  expect(await controller.forkConversation(source.id, "first")).toBe(false);
  expect(guiApi.request).not.toHaveBeenCalledWith(expect.objectContaining({ operation: "fork" }));
  controller.dispose();
});

it("branches an unopened conversation at its latest turn using its own model choice", async () => {
  const controller = new GuiController();
  await controller.connect();
  controller.settings({ model: "draft-model", effort: "low" });
  controller.modelSettings.created(source.id, { model: "source-model", effort: "high" });
  expect(controller.getSnapshot().conversations.source).toBeUndefined();
  expect(await controller.forkConversation(source.id)).toBe(true);
  expect(guiApi.request).toHaveBeenCalledWith({ operation: "read", threadId: source.id });
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ operation: "fork",
    threadId: source.id, turnId: "last" }));
  expect(controller.getSnapshot()).toMatchObject({ selected: fork.id,
    settings: { model: "source-model", effort: "high" } });
  expect(controller.getSnapshot().conversations.source).toBeUndefined();
  controller.dispose();
});

it("refreshes cached history before choosing the latest branch point", async () => {
  const controller = await setup();
  const cached = controller.getSnapshot().conversations.source;
  vi.mocked(guiApi.request).mockResolvedValueOnce({ thread: { ...source,
    turns: [...source.turns!, { id: "newer", status: "completed", items: [] }] } });
  expect(await controller.forkConversation(source.id)).toBe(true);
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ operation: "fork", turnId: "newer" }));
  expect(controller.getSnapshot().conversations.source).toBe(cached);
  controller.dispose();
});

it("prevents duplicate forks while reading history and preserves a later navigation", async () => {
  const controller = await setup();
  let finish!: (response: { thread: Thread }) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = controller.forkConversation(source.id);
  expect(controller.getSnapshot().forking).toBe(source.id);
  expect(await controller.forkConversation(source.id)).toBe(false);
  controller.newConversation();
  finish({ thread: source });
  expect(await pending).toBe(true);
  expect(controller.getSnapshot().selected).toBeNull();
  expect(controller.getSnapshot().conversations.fork.thread.id).toBe(fork.id);
  controller.dispose();
});

it.each([
  { turns: [], error: "这条对话还没有可用于创建分支的消息。" },
  { turns: [{ id: "active", status: "inProgress", items: [] }], error: "请等待当前回复完成后，再创建分支。" },
])("leaves the source intact when the latest history cannot be branched: $error", async ({ turns, error }) => {
  const controller = await setup();
  vi.mocked(guiApi.request).mockResolvedValueOnce({ thread: { ...source, turns } });
  expect(await controller.forkConversation(source.id)).toBe(false);
  expect(guiApi.request).not.toHaveBeenCalledWith(expect.objectContaining({ operation: "fork" }));
  expect(controller.getSnapshot()).toMatchObject({ selected: source.id, error, forking: undefined });
  controller.dispose();
});
