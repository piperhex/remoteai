// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "./api";
import { testModels } from "./testModels";
import { GuiController } from "./controller";
import { CONTINUE_MESSAGE } from "./continuation";
import { isModelCapacityError, MODEL_CAPACITY_MESSAGE } from "./requestError";
import type { GuiEvent, Thread, Turn } from "./types";

vi.mock("./api", () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn(), respond: vi.fn() } }));
let controller: GuiController;
let receive: (event: GuiEvent) => void;
let nextTurn: number;
const capacityError = { message: MODEL_CAPACITY_MESSAGE };

function thread(): Thread {
  return { id: "one", cwd: "D:/project", preview: "test", updatedAt: 1,
    turns: controller.getSnapshot().conversations.one?.turns ?? [] };
}

function finish(id: string, status = "failed", error: Turn["error"] = capacityError) {
  receive({ method: "turn/completed", params: { threadId: "one", turn: { id, status, error, items: [] } } });
}

const sends = () => vi.mocked(guiApi.request).mock.calls.filter(([request]) => request.operation === "send");

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  localStorage.clear();
  nextTurn = 0;
  controller = new GuiController();
  controller.capacityRetry.setActive(true);
  vi.spyOn(controller.titles, "generate").mockResolvedValue();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockImplementation(async (callback) => { receive = callback; return vi.fn<() => void>(); });
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "models") return { data: testModels, nextCursor: null };
    if (request.operation === "list") return { data: [], nextCursor: null };
    if (request.operation === "send") return { turn: { id: `retry-${++nextTurn}`, status: "inProgress", items: [] } };
    return { thread: thread() };
  });
  await controller.connect();
  await controller.select("one");
});

afterEach(() => { controller.dispose(); vi.useRealTimers(); });

it("recognizes the capacity message in structured details without retrying unrelated failures", () => {
  expect(isModelCapacityError(capacityError)).toBe(true);
  expect(isModelCapacityError({ message: "Request failed", additionalDetails:
    JSON.stringify({ message: MODEL_CAPACITY_MESSAGE.toUpperCase() }) })).toBe(true);
  expect(isModelCapacityError({ message: "HTTP 429: quota exceeded" })).toBe(false);
  expect(isModelCapacityError({ message: "HTTP 503: service unavailable" })).toBe(false);
  expect(isModelCapacityError(null)).toBe(false);
});

it("counts down and retries at 1, 3, 5 and 7 seconds, retaining model and access choices", async () => {
  controller.settings({ model: "gpt-test", effort: "high", access: "read-only" });
  finish("initial");
  for (const [index, seconds] of [1, 3, 5, 7].entries()) {
    expect(controller.getSnapshot().capacityRetry?.seconds).toBe(seconds);
    await vi.advanceTimersByTimeAsync((seconds - 1) * 1000);
    expect(controller.getSnapshot().capacityRetry?.seconds).toBe(1);
    expect(sends()).toHaveLength(index);
    await vi.advanceTimersByTimeAsync(999);
    expect(sends()).toHaveLength(index);
    await vi.advanceTimersByTimeAsync(1);
    expect(sends()).toHaveLength(index + 1);
    expect(sends().at(-1)?.[0]).toMatchObject({ operation: "send", threadId: "one", text: CONTINUE_MESSAGE,
      model: "gpt-test", effort: "high", access: "read-only" });
    expect(controller.getSnapshot().capacityRetry).toBeUndefined();
    finish(`retry-${index + 1}`);
  }
});

it("does not race server retries or retry a recovered, interrupted or unrelated failed turn", async () => {
  receive({ method: "turn/started", params: { threadId: "one",
    turn: { id: "initial", status: "inProgress", items: [] } } });
  receive({ method: "error", params: { threadId: "one", turnId: "initial", willRetry: true, error: capacityError } });
  await vi.advanceTimersByTimeAsync(10000);
  expect(sends()).toHaveLength(0);
  finish("initial", "completed", null);
  finish("interrupted", "interrupted");
  finish("quota", "failed", { message: "HTTP 429: quota exceeded" });
  await vi.advanceTimersByTimeAsync(10000);
  expect(sends()).toHaveLength(0);
});

it("uses a preceding terminal error event when completion omits the error", async () => {
  receive({ method: "turn/started", params: { threadId: "one",
    turn: { id: "initial", status: "inProgress", items: [] } } });
  receive({ method: "error", params: { threadId: "one", turnId: "initial", willRetry: false, error: capacityError } });
  receive({ method: "turn/completed", params: { threadId: "one",
    turn: { id: "initial", status: "failed", items: [] } } });
  expect(controller.getSnapshot().capacityRetry?.seconds).toBe(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(sends()).toHaveLength(1);
});

it("ignores duplicate completion events and never restarts a cancelled retry from history", async () => {
  finish("initial");
  finish("initial");
  expect(controller.getSnapshot().capacityRetry?.seconds).toBe(1);
  controller.capacityRetry.cancel();
  await controller.select("one");
  finish("initial");
  await vi.advanceTimersByTimeAsync(10000);
  expect(sends()).toHaveLength(0);
});

it.each(["switch", "disconnect", "stop", "hidden", "dispose", "archive"])(
  "cancels the timer on %s", async (action) => {
    finish("initial");
    if (action === "switch") controller.newConversation();
    if (action === "disconnect") receive({ method: "connection/closed", params: {} });
    if (action === "stop") await controller.interrupt();
    if (action === "hidden") controller.capacityRetry.setActive(false);
    if (action === "dispose") controller.dispose();
    if (action === "archive") controller.filter("", true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(controller.getSnapshot().capacityRetry).toBeUndefined();
    expect(sends()).toHaveLength(0);
  });

it("does not begin retries while the conversation view is inactive", async () => {
  controller.capacityRetry.setActive(false);
  finish("initial");
  controller.capacityRetry.setActive(true);
  await vi.advanceTimersByTimeAsync(10000);
  expect(sends()).toHaveLength(0);
});

it("does not restart after stopping when a capacity failure races the interruption", async () => {
  finish("initial");
  await vi.advanceTimersByTimeAsync(1000);
  await controller.interrupt();
  finish("retry-1");
  await vi.advanceTimersByTimeAsync(10000);
  expect(sends()).toHaveLength(1);
  expect(controller.getSnapshot().capacityRetry).toBeUndefined();
});

it("lets queued user messages proceed without adding an automatic continuation", async () => {
  receive({ method: "turn/started", params: { threadId: "one",
    turn: { id: "initial", status: "inProgress", items: [] } } });
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  vi.mocked(guiApi.request).mockImplementation(async (request) => request.operation === "sendBatch"
    ? { turn: { id: "queued", status: "inProgress", items: [] } } : original(request));
  await controller.send("next question", []);
  finish("initial");
  await vi.advanceTimersByTimeAsync(10000);
  expect(sends()).toHaveLength(0);
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ operation: "sendBatch" }));
  expect(controller.getSnapshot().capacityRetry).toBeUndefined();
});

it("resets the delay after success and lets a new user message replace a pending retry", async () => {
  finish("initial");
  await vi.advanceTimersByTimeAsync(1000);
  finish("retry-1", "completed", null);
  await controller.send("new question", []);
  finish("retry-2");
  expect(controller.getSnapshot().capacityRetry?.seconds).toBe(1);
  await controller.send("changed my mind", []);
  await vi.advanceTimersByTimeAsync(10000);
  expect(sends()).toHaveLength(3);
  expect(controller.getSnapshot().capacityRetry).toBeUndefined();
  finish("retry-3");
  expect(controller.getSnapshot().capacityRetry?.seconds).toBe(1);
});

it("keeps the next delay when completion arrives before the send acknowledgement", async () => {
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  let acknowledge!: (response: unknown) => void;
  vi.mocked(guiApi.request).mockImplementation((request) => {
    if (request.operation !== "send") return original(request);
    finish("early");
    return new Promise((resolve) => { acknowledge = resolve; });
  });
  finish("initial");
  await vi.advanceTimersByTimeAsync(1000);
  expect(controller.getSnapshot().capacityRetry?.seconds).toBe(3);
  await vi.advanceTimersByTimeAsync(5000);
  expect(sends()).toHaveLength(1);
  acknowledge({ turn: { id: "early", status: "inProgress", items: [] } });
  await vi.advanceTimersByTimeAsync(0);
  expect(controller.getSnapshot().capacityRetry?.seconds).toBe(0);
  controller.capacityRetry.cancel();
});

it("does not submit a retry if cancelled while resuming the conversation", async () => {
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  let resume!: (response: unknown) => void;
  vi.mocked(guiApi.request).mockImplementation((request) => request.operation === "resume"
    ? new Promise((resolve) => { resume = resolve; }) : original(request));
  finish("initial");
  await vi.advanceTimersByTimeAsync(1000);
  controller.newConversation();
  resume({ thread: thread() });
  await vi.advanceTimersByTimeAsync(0);
  expect(sends()).toHaveLength(0);
  expect(controller.getSnapshot().selected).toBeNull();
});
