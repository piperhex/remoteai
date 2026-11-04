// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GuiController } from "./controller";
import { guiApi } from "../../../../../shared/conversation/api";
import { compactCommand } from "./composerOptions";
import type { GuiEvent, Thread } from "../../../../../shared/conversation/types";

vi.mock("../../../../../shared/conversation/api", () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
const thread: Thread = { id: "one", cwd: "D:/project", preview: "hello", updatedAt: 1, turns: [] };
let receive: (event: GuiEvent) => void;
let controller: GuiController;
beforeEach(async () => {
  localStorage.clear();
  vi.resetAllMocks();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockImplementation(async (callback) => { receive = callback; return () => {}; });
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "list" || request.operation === "models") return { data: [], nextCursor: null };
    if (request.operation === "compact") return {};
    return { thread };
  });
  controller = new GuiController();
  await controller.connect();
  await controller.select(thread.id);
});
afterEach(() => controller.dispose());

it("resumes history before compacting and holds the guard until completion", async () => {
  expect(await controller.compact()).toBe(true);
  const requests = vi.mocked(guiApi.request).mock.calls.map(([request]) => request);
  expect(requests.slice(-2)).toEqual([
    { operation: "resume", threadId: thread.id, access: controller.getSnapshot().settings.access },
    { operation: "compact", threadId: thread.id },
  ]);
  expect(controller.getSnapshot().compacting).toBe(thread.id);
  expect(await controller.compact()).toBe(false);
  expect(await controller.send("do not send", [])).toBe(false);
  expect(await controller.deleteThread(thread.id)).toBe(false);
  receive({ method: "turn/started", params: { threadId: thread.id,
    turn: { id: "compact-turn", status: "inProgress", items: [] } } });
  receive({ method: "item/started", params: { threadId: thread.id, turnId: "compact-turn",
    item: { id: "compact-item", type: "contextCompaction" } } });
  expect(controller.getSnapshot().conversations.one.turns[0].items[0].type).toBe("contextCompaction");
  receive({ method: "turn/completed", params: { threadId: thread.id,
    turn: { id: "compact-turn", status: "completed", items: [] } } });
  expect(controller.getSnapshot().compacting).toBeUndefined();
  expect(compactCommand(controller.getSnapshot(), vi.fn()).enabled).toBe(true);
});

it("releases the guard on request failure and allows retry", async () => {
  vi.mocked(guiApi.request).mockRejectedValueOnce(new Error("unavailable"));
  expect(await controller.compact()).toBe(false);
  expect(controller.getSnapshot().compacting).toBeUndefined();
  expect(controller.getSnapshot().error).not.toBe("");
  expect(await controller.compact()).toBe(true);
});

it.each(["error", "connection/closed"])("releases pending compaction on %s", async (method) => {
  await controller.compact();
  receive({ method, params: { threadId: thread.id, willRetry: false } });
  expect(controller.getSnapshot().compacting).toBeUndefined();
});

it("keeps the guard during retryable errors and ignores completion from another thread", async () => {
  await controller.compact();
  receive({ method: "error", params: { threadId: thread.id, willRetry: true } });
  receive({ method: "turn/completed", params: { threadId: "other",
    turn: { id: "other-turn", status: "completed", items: [] } } });
  expect(controller.getSnapshot().compacting).toBe(thread.id);
});

it("blocks compaction for active, archived, new and queued conversations", async () => {
  receive({ method: "turn/started", params: { threadId: thread.id,
    turn: { id: "live", status: "inProgress", items: [] } } });
  expect(await controller.compact()).toBe(false);
  receive({ method: "turn/completed", params: { threadId: thread.id,
    turn: { id: "live", status: "completed", items: [] } } });
  controller.filter("", true);
  expect(await controller.compact()).toBe(false);
  controller.filter("", false);
  controller.queue.enqueue(thread.id, { text: "queued", images: [], skills: [] });
  expect(await controller.compact()).toBe(false);
  controller.newConversation();
  expect(await controller.compact()).toBe(false);
  expect(guiApi.request).not.toHaveBeenCalledWith({ operation: "compact", threadId: thread.id });
});

it("uses latest context tokens rather than cumulative usage and updates after compaction", () => {
  const command = () => compactCommand(controller.getSnapshot(), vi.fn());
  expect(command().description).toBe("压缩此对话的上下文");
  receive({ method: "thread/tokenUsage/updated", params: { threadId: thread.id,
    tokenUsage: { total: { totalTokens: 90_000 }, last: { totalTokens: 30_000 }, modelContextWindow: 100_000 } } });
  expect(command().percent).toBe(30);
  expect(command().description).toContain("已使用 30%");
  receive({ method: "thread/tokenUsage/updated", params: { threadId: thread.id,
    tokenUsage: { total: { totalTokens: 95_000 }, last: { totalTokens: 5_000 }, modelContextWindow: 100_000 } } });
  expect(command().percent).toBe(5);
});

it("does not resurrect compaction if its completion arrives before the acknowledgement", async () => {
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "compact") {
      receive({ method: "turn/completed", params: { threadId: thread.id,
        turn: { id: "fast", status: "completed", items: [] } } });
    }
    return { thread, data: [], nextCursor: null };
  });
  expect(await controller.compact()).toBe(true);
  expect(controller.getSnapshot().compacting).toBeUndefined();
});
