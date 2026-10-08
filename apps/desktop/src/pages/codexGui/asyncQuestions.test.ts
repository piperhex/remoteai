// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { asyncAnswerText, pendingAsyncQuestions } from "./asyncQuestionState";
import { GuiController } from "./controller";
import { guiApi } from "./api";
import { testModels } from "./testModels";
import { conversation, reduceConversation } from "./events";
import type { GuiEvent, Item, Thread } from "./types";

vi.mock("./api", () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
const question: Item = { id: "ask", type: "agentMessage", delivery: "async", phase: "final_answer",
  text: "哪里卡住了？\n- 切换时\n- 发消息时", questions: [{ title: "哪里卡住了？", options: ["切换时", "发消息时"] }] };
const thread: Thread = { id: "one", cwd: "D:/project", preview: "", updatedAt: 1,
  turns: [{ id: "turn", status: "inProgress", items: [question] }] };
let receive: (event: GuiEvent) => void;

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockImplementation(async (callback) => { receive = callback; return vi.fn<() => void>(); });
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "models") return { data: testModels, nextCursor: null };
    if (request.operation === "list") return { data: [], nextCursor: null };
    if (request.operation === "send") return { turn: { id: "next", status: "inProgress", items: [] } };
    return { thread };
  });
});

it("restores async questions from history and preserves them through live completion", () => {
  let value = conversation({ ...thread, turns: [] });
  value = reduceConversation(value, { method: "item/completed",
    params: { threadId: thread.id, turnId: "turn", item: question } });
  value = reduceConversation(value, { method: "turn/completed",
    params: { threadId: thread.id, turn: { id: "turn", status: "completed", items: [] } } });
  expect(pendingAsyncQuestions(value)).toEqual([question]);
  expect(pendingAsyncQuestions(conversation(thread))).toEqual([question]);
  const plain = { ...question, delivery: undefined, questions: undefined };
  expect(pendingAsyncQuestions(conversation({ ...thread,
    turns: [{ id: "turn", status: "completed", items: [plain] }] }))).toEqual([]);
});

it("clears answered history without dropping a different pending card", () => {
  const other = { ...question, id: "other", questions: [{ title: "在哪个系统？" }] };
  const reply: Item = { id: "reply", type: "userMessage",
    content: [{ type: "text", text: asyncAnswerText(question, ["切换时"])! }] };
  const value = conversation({ ...thread, turns: [{ id: "turn", status: "completed", items: [question, other, reply] }] });
  expect(pendingAsyncQuestions(value)).toEqual([other]);
  reply.content = [{ type: "text", text: "点切换后一直转圈" }];
  expect(pendingAsyncQuestions(value)).toEqual([]);
  expect(asyncAnswerText(question, [])).toBeNull();
  expect(asyncAnswerText(question, ["  "])).toBeNull();
});

it("sends an answer into the running turn immediately and records a user message", async () => {
  const controller = new GuiController();
  await controller.connect(); await controller.select(thread.id);
  expect(await controller.answerAsyncQuestion(question, ["发消息时"])).toBe(true);
  expect(guiApi.request).toHaveBeenCalledWith({ operation: "steer", threadId: "one", turnId: "turn",
    text: "哪里卡住了？\n发消息时", images: [], skills: [] });
  expect(controller.getSnapshot().queued.one ?? []).toEqual([]);
  expect(pendingAsyncQuestions(controller.getSnapshot().conversations.one)).toEqual([]);
  expect(await controller.answerAsyncQuestion(question, ["发消息时"])).toBe(false);
  controller.dispose();
});

it("keeps the question available after a failed send and retries after the turn finishes", async () => {
  const controller = new GuiController();
  await controller.connect(); await controller.select(thread.id);
  vi.mocked(guiApi.request).mockRejectedValueOnce(new Error("发送失败"));
  expect(await controller.answerAsyncQuestion(question, ["切换时"])).toBe(false);
  expect(pendingAsyncQuestions(controller.getSnapshot().conversations.one)).toHaveLength(1);
  receive({ method: "turn/completed", params: { threadId: "one",
    turn: { id: "turn", status: "completed", items: [] } } });
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "resume") return { thread: { ...thread,
      turns: [{ id: "turn", status: "completed", items: [question] }] } };
    if (request.operation === "send") return { turn: { id: "next", status: "inProgress", items: [] } };
    return { data: [], nextCursor: null };
  });
  expect(await controller.answerAsyncQuestion(question, ["切换时"])).toBe(true);
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ operation: "send", text: "哪里卡住了？\n切换时" }));
  controller.dispose();
});

it("does not send twice while the first answer is awaiting acknowledgement", async () => {
  const controller = new GuiController();
  await controller.connect(); await controller.select(thread.id);
  let resolve!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const first = controller.answerAsyncQuestion(question, ["切换时"]);
  expect(await controller.answerAsyncQuestion(question, ["发消息时"])).toBe(false);
  resolve({}); expect(await first).toBe(true);
  controller.dispose();
});

it("keeps one reply and flushes queued messages when completion beats the answer acknowledgement", async () => {
  const controller = new GuiController();
  await controller.connect(); await controller.select(thread.id);
  controller.queue.enqueue(thread.id, { text: "继续检查", images: [], skills: [] });
  let resolve!: (value: unknown) => void;
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "steer") return new Promise((done) => { resolve = done; });
    if (request.operation === "resume") return { thread: { ...thread,
      turns: [{ id: "turn", status: "completed", items: [] }] } };
    if (request.operation === "sendBatch") return { turn: { id: "next", status: "completed", items: [] } };
    return original(request);
  });
  const sending = controller.answerAsyncQuestion(question, ["切换时"]);
  receive({ method: "item/completed", params: { threadId: "one", turnId: "turn",
    item: { id: "server-reply", type: "userMessage", content: [{ type: "text", text: "哪里卡住了？\n切换时" }] } } });
  receive({ method: "turn/completed", params: { threadId: "one",
    turn: { id: "turn", status: "completed", items: [] } } });
  resolve({}); expect(await sending).toBe(true);
  await vi.waitFor(() => expect(controller.getSnapshot().queued.one).toEqual([]));
  const completed = controller.getSnapshot().conversations.one.turns.find((turn) => turn.id === "turn")!;
  expect(completed.items.filter((item) => item.type === "userMessage")).toHaveLength(1);
  expect(controller.getSnapshot().conversations.one.activeTurn).toBeNull();
  controller.dispose();
});
