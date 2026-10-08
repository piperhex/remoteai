// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "./api";
import { testModels } from "./testModels";
import { GuiController } from "./controller";
import type { GuiEvent, Thread } from "./types";

vi.mock("./api", () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
const thread: Thread = { id: "one", cwd: "", preview: "hello", updatedAt: 1, turns: [] };
let controller: GuiController;
let receive: (event: GuiEvent) => void;
const messages = () => controller.getSnapshot().queued.one ?? [];
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const finish = async () => {
  receive({ method: "turn/completed", params: { threadId: "one",
    turn: { id: "live", status: "completed", items: [] } } });
  await settle();
};
beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockImplementation(async (callback) => { receive = callback; return vi.fn<() => void>(); });
  let batchCount = 0;
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "models") return { data: testModels, nextCursor: null };
    if (request.operation === "list") return { data: [], nextCursor: null };
    if (request.operation === "sendBatch") return {
      turn: { id: batchCount++ ? "next-batch" : "batch", status: "inProgress", items: [] } };
    if (request.operation === "resume") return { thread: {
      ...thread, turns: controller.getSnapshot().conversations.one?.turns ?? [] } };
    return { thread };
  });
  controller = new GuiController();
  await controller.connect();
  await controller.select("one");
  receive({ method: "turn/started", params: { threadId: "one",
    turn: { id: "live", status: "inProgress", items: [] } } });
});
afterEach(() => controller.dispose());

it("sends queued turns with the access saved when queued, including after switching conversations", async () => {
  controller.settings({ access: "danger-full-access" });
  await controller.send("continue", []);
  controller.newConversation();
  controller.settings({ access: "read-only" });
  await finish();
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({
    operation: "sendBatch", threadId: "one", access: "danger-full-access" }));
});

it("applies settings changed during generation to all waiting messages on the next turn", async () => {
  controller.settings({ model: "old-model", effort: "low", access: "read-only" });
  await controller.send("first", []);
  await controller.send("second", []);
  vi.mocked(guiApi.request).mockClear();
  const settings = { model: "next-model", effort: "high", access: "workspace-write" } as const;
  controller.settings(settings);
  expect(guiApi.request).not.toHaveBeenCalled();
  expect(controller.getSnapshot().conversations.one.activeTurn).toBe("live");
  expect(messages()).toHaveLength(2);
  messages().forEach((message) => expect(message).toMatchObject(settings));
  await finish();
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ operation: "resume", access: settings.access }));
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ operation: "sendBatch", ...settings }));
});

it("keeps a dispatched batch stable when settings change while resuming", async () => {
  const previous = { model: "old-model", effort: "low", access: "read-only" } as const;
  const next = { model: "next-model", effort: "high", access: "workspace-write" } as const;
  controller.settings(previous);
  await controller.send("first", []);
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  let resume!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementation((request) => request.operation === "resume"
    ? new Promise((resolve) => { resume = resolve; }) : original(request));
  await finish();
  controller.settings(next);
  expect(messages()[0]).toMatchObject({ ...previous, busy: true });
  await controller.send("second", []);
  expect(messages()[1]).toMatchObject(next);
  resume({ thread });
  await settle();
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ operation: "sendBatch", ...previous }));
  expect(messages()).toHaveLength(1);
  expect(messages()[0]).toMatchObject(next);
});

it("queues separate messages and submits all in order to their original background conversation", async () => {
  await controller.send("first", ["image"], [{ name: "skill", path: "skill-path" }]);
  await controller.send("second", []);
  expect(messages().map((item) => item.text)).toEqual(["first", "second"]);
  expect(guiApi.request).not.toHaveBeenCalledWith(expect.objectContaining({ operation: "steer" }));
  controller.newConversation();
  await finish();
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ operation: "sendBatch", threadId: "one",
    messages: [{ text: "first", images: ["image"], skills: [{ name: "skill", path: "skill-path" }] },
      { text: "second", images: [], skills: [] }] }));
  expect(messages()).toEqual([]);
  expect(controller.getSnapshot().selected).toBeNull();
});

it("sends messages in their reordered sequence and ignores moves beyond the queue", async () => {
  await controller.send("first", ["image"], [{ name: "skill", path: "skill-path" }]);
  await controller.send("second", []);
  await controller.send("third", []);
  const [first, second, third] = messages();
  controller.queue.move("one", first.id, "up");
  controller.queue.move("one", third.id, "down");
  controller.queue.move("one", "missing", "down");
  expect(messages()).toEqual([first, second, third]);
  controller.queue.move("one", third.id, "up");
  controller.queue.move("one", first.id, "down");
  expect(messages()).toEqual([third, first, second]);
  await finish();
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ operation: "sendBatch",
    messages: [{ text: "third", images: [], skills: [] },
      { text: "first", images: ["image"], skills: [{ name: "skill", path: "skill-path" }] },
      { text: "second", images: [], skills: [] }] }));
});

it("prevents reordering a dispatched message or moving another message across it", async () => {
  await controller.send("sending", []);
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  let resume!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementation((request) => request.operation === "resume"
    ? new Promise((resolve) => { resume = resolve; }) : original(request));
  await finish();
  await controller.send("waiting", []);
  const [sending, waiting] = messages();
  expect(sending.busy).toBe(true);
  controller.queue.move("one", sending.id, "down");
  controller.queue.move("one", waiting.id, "up");
  expect(messages()).toEqual([sending, waiting]);
  resume({ thread });
  await settle();
  expect(messages().map((item) => item.text)).toEqual(["waiting"]);
});

it("takes a message out for editing while the remaining queue still sends", async () => {
  await controller.send("first", []);
  await controller.send("second", []);
  const [first, second] = messages();
  expect(controller.queue.take("one", first.id)).toMatchObject({ text: "first", images: [], skills: [] });
  expect(controller.queue.take("one", first.id)).toBeUndefined();
  expect(messages()).toEqual([second]);
  await finish();
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({
    operation: "sendBatch", messages: [{ text: "second", images: [], skills: [] }] }));
});

it("does not take a message that is already being sent", async () => {
  await controller.send("first", []);
  const first = messages()[0];
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  let resume!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementation((request) => request.operation === "resume"
    ? new Promise((resolve) => { resume = resolve; }) : original(request));
  await finish();
  expect(controller.queue.take("one", first.id)).toBeUndefined();
  expect(messages()).toHaveLength(1);
  resume({ thread });
  await settle();
  expect(messages()).toEqual([]);
});

it("steers only the chosen item and prevents duplicate clicks", async () => {
  await controller.send("now", []);
  await controller.send("later", []);
  const id = messages()[0].id;
  await Promise.all([controller.queue.steer("one", id), controller.queue.steer("one", id)]);
  expect(guiApi.request).toHaveBeenCalledWith({ operation: "steer", threadId: "one", turnId: "live",
    text: "now", images: [], skills: [] });
  expect(vi.mocked(guiApi.request).mock.calls.filter(([request]) => request.operation === "steer")).toHaveLength(1);
  expect(messages().map((item) => item.text)).toEqual(["later"]);
});

it("keeps failed batches available for retry and does not loop", async () => {
  await controller.send("keep me", []);
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "sendBatch") throw new Error("暂时无法发送");
    return original(request);
  });
  await finish();
  expect(messages()[0]).toMatchObject({ text: "keep me", busy: false });
  expect(controller.getSnapshot().conversations.one.turns.flatMap((turn) => turn.items)).toEqual([]);
  expect(controller.getSnapshot().error).toBe("暂时无法发送");
  expect(vi.mocked(guiApi.request).mock.calls.filter(([request]) => request.operation === "sendBatch")).toHaveLength(1);
  vi.mocked(guiApi.request).mockImplementation(original);
  await controller.queue.flush("one");
  expect(messages()[0].needsReview).toBe(true);
  expect(vi.mocked(guiApi.request).mock.calls.filter(([request]) => request.operation === "sendBatch")).toHaveLength(1);
  await controller.queue.flush("one", true);
  expect(messages()).toEqual([]);
});

it("merges acknowledgement items after an earlier turn event without reviving a completed turn", async () => {
  await controller.send("continue", []);
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  const input = { id: "input", type: "userMessage", content: [{ type: "text", text: "continue" }] };
  const answer = { id: "answer", type: "agentMessage", text: "Finished checking" };
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation !== "sendBatch") return original(request);
    receive({ method: "turn/completed", params: { threadId: "one",
      turn: { id: "batch", status: "completed", items: [answer] } } });
    return { turn: { id: "batch", status: "inProgress", items: [input, { ...answer, text: "" }] } };
  });
  await finish();
  const completed = controller.getSnapshot().conversations.one.turns.find((turn) => turn.id === "batch");
  expect(completed).toMatchObject({ status: "completed", items: [input, answer] });
  expect(controller.getSnapshot().conversations.one.activeTurn).toBeNull();
  expect(messages()).toEqual([]);
});

it("never sends after disconnect or disposal", async () => {
  await controller.send("keep me", []);
  receive({ method: "connection/closed", params: {} });
  await controller.queue.flush("one");
  controller.dispose();
  await controller.queue.flush("one");
  expect(messages()).toHaveLength(1);
  expect(guiApi.request).not.toHaveBeenCalledWith(expect.objectContaining({ operation: "sendBatch" }));
});

it("waits when resuming reveals a turn still running on the server", async () => {
  await controller.send("wait for me", []);
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  vi.mocked(guiApi.request).mockImplementation(async (request) => request.operation === "resume"
    ? { thread: { ...thread, turns: [{ id: "server-live", status: "inProgress", items: [] }] } }
    : original(request));
  await finish();
  expect(controller.getSnapshot().conversations.one.activeTurn).toBe("server-live");
  expect(messages()[0]).toMatchObject({ text: "wait for me", busy: false });
  expect(guiApi.request).not.toHaveBeenCalledWith(expect.objectContaining({ operation: "sendBatch" }));
  vi.mocked(guiApi.request).mockImplementation(original);
  receive({ method: "turn/completed", params: { threadId: "one",
    turn: { id: "server-live", status: "completed", items: [] } } });
  await settle();
  expect(messages()).toEqual([]);
});

it("does not start another batch on a duplicate completion for an older turn", async () => {
  await controller.send("first", []);
  await finish();
  await controller.send("second", []);
  await finish();
  expect(controller.getSnapshot().conversations.one.activeTurn).toBe("batch");
  expect(messages().map((item) => item.text)).toEqual(["second"]);
  expect(vi.mocked(guiApi.request).mock.calls.filter(([request]) => request.operation === "sendBatch")).toHaveLength(1);
});

it("preserves new queue entries when an earlier batch finishes before its request resolves", async () => {
  await controller.send("first", []);
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  let resolve!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementation((request) => request.operation === "sendBatch"
    ? new Promise((done) => { resolve = done; }) : original(request));
  await finish();
  await controller.send("second", []);
  receive({ method: "turn/completed", params: { threadId: "one",
    turn: { id: "batch", status: "completed", items: [] } } });
  vi.mocked(guiApi.request).mockImplementation(original);
  resolve({ turn: { id: "batch", status: "inProgress", items: [] } });
  await settle();
  expect(vi.mocked(guiApi.request).mock.calls.filter(([request]) => request.operation === "sendBatch")).toHaveLength(2);
  expect(messages()).toEqual([]);
  expect(controller.getSnapshot().conversations.one.turns.find((turn) => turn.id === "batch")?.status).toBe("completed");
});
