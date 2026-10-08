// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "./api";
import { testModels } from "./testModels";
import { GuiController } from "./controller";
import type { GuiEvent, Thread } from "./types";
import type { ThreadGoal } from "./goalTypes";

vi.mock("./api", () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
const thread: Thread = { id: "one", cwd: "D:/project", preview: "hello", updatedAt: 1, turns: [] };
const goal: ThreadGoal = { threadId: thread.id, objective: "完成登录页面", status: "active", tokenBudget: null,
  tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1 };
let receive: (event: GuiEvent) => void;
let controller: GuiController;

beforeEach(async () => {
  localStorage.clear(); vi.resetAllMocks();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockImplementation(async (callback) => { receive = callback; return () => {}; });
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "models") return { data: testModels, nextCursor: null };
    if (request.operation === "list") return { data: [], nextCursor: null };
    if (request.operation === "goalGet") return { goal: null };
    if (request.operation === "goalSet") return { goal: { ...goal, status: request.status } };
    if (request.operation === "send") return { turn: { id: "turn", status: "completed", items: [] } };
    return { thread };
  });
  controller = new GuiController(); await controller.connect();
});
afterEach(() => controller.dispose());

it("creates a conversation for an explicit goal and leaves its continuation to the engine", async () => {
  expect(await controller.goals.set({ objective: goal.objective, status: "active" })).toBe(true);
  expect(controller.getSnapshot().selected).toBe(thread.id);
  expect(controller.getSnapshot().goals?.one).toEqual(goal);
  expect(guiApi.request).toHaveBeenCalledWith({ operation: "goalSet", threadId: thread.id,
    objective: goal.objective, status: "active" });
  expect(vi.mocked(guiApi.request).mock.calls.some(([request]) => request.operation === "send")).toBe(false);
});

it("does not create a goal for ordinary messages", async () => {
  await controller.send("hello", []);
  expect(vi.mocked(guiApi.request).mock.calls.some(([request]) => request.operation === "goalSet")).toBe(false);
});

it("pauses the goal before stopping its active turn", async () => {
  await controller.goals.set({ objective: goal.objective, status: "active" });
  receive({ method: "turn/started", params: { threadId: thread.id,
    turn: { id: "working", status: "inProgress", items: [] } } });
  vi.mocked(guiApi.request).mockClear();
  await controller.interrupt();
  const operations = vi.mocked(guiApi.request).mock.calls.map(([request]) => request.operation);
  expect(operations).toEqual(["goalSet", "interrupt"]);
  expect(controller.getSnapshot().goals?.one?.status).toBe("paused");
});

it("keeps a newer goal event when the set acknowledgement arrives late", async () => {
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "goalSet") {
      receive({ method: "thread/goal/updated", params: { threadId: thread.id,
        goal: { ...goal, status: "complete", tokensUsed: 300, updatedAt: 2 } } });
      return { goal };
    }
    return { thread };
  });
  await controller.goals.set({ objective: goal.objective, status: "active" });
  expect(controller.getSnapshot().goals?.one?.status).toBe("complete");
  expect(controller.getSnapshot().goals?.one?.tokensUsed).toBe(300);
});

it("preserves goal state on failure and prevents overlapping requests", async () => {
  await controller.goals.set({ objective: goal.objective, status: "active" });
  let reject!: (error: Error) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const pending = controller.goals.set({ status: "paused" });
  expect(await controller.goals.set({ status: "paused" })).toBe(false);
  reject(new Error("unavailable"));
  expect(await pending).toBe(false);
  expect(controller.getSnapshot().goals?.one).toEqual(goal);
  expect(controller.getSnapshot().goalBusy).toBe(false);
});

it("restores persisted goals without replacing a newer notification", async () => {
  let resolve!: (response: { goal: ThreadGoal }) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const pending = controller.goals.load(thread.id);
  receive({ method: "thread/goal/updated", params: { threadId: thread.id, goal: { ...goal, status: "paused" } } });
  resolve({ goal }); await pending;
  expect(controller.getSnapshot().goals?.one?.status).toBe("paused");
  receive({ method: "thread/goal/cleared", params: { threadId: thread.id } });
  expect(controller.getSnapshot().goals?.one).toBeNull();
});

it("keeps goal results attached to their conversation when selection changes", async () => {
  let finish!: (response: { thread: Thread }) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((done) => { finish = done; }));
  const pending = controller.goals.set({ objective: goal.objective, status: "active" });
  await controller.select("other");
  finish({ thread }); await pending;
  expect(controller.getSnapshot().selected).toBe("other");
  expect(controller.getSnapshot().goals?.one).toEqual(goal);
});
