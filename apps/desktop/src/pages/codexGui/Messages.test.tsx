// @vitest-environment jsdom
import { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "./api";
import { testModels } from "./testModels";
import { GuiController } from "./controller";
import { Messages } from "./Messages";
import { conversation } from "./events";
import { CONTINUE_MESSAGE } from "./continuation";
import type { GuiEvent, Item, Thread, Turn } from "./types";

vi.mock("./api", () => ({ guiApi: {
  connect: vi.fn(), request: vi.fn(), subscribe: vi.fn(), respond: vi.fn(),
} }));
const items: Item[] = [
  { id: "question", type: "userMessage", content: [{ type: "text", text: "检查这个项目" },
    { type: "localImage", path: "D:/screenshot.png" }] },
  { id: "reason", type: "reasoning", summary: ["先检查项目的测试结果"] },
  { id: "command", type: "commandExecution", command: "npm test", aggregatedOutput: "PASS: project tests",
    status: "completed", exitCode: 0 },
  { id: "answer", type: "agentMessage", text: "项目检查通过" },
];
const thread: Thread = { id: "one", cwd: "D:/project", preview: "检查这个项目", updatedAt: 1,
  turns: [{ id: "turn", status: "completed", items }] };
let root: Root;
let container: HTMLDivElement;
let controller: GuiController;
let receive: (event: GuiEvent) => void;
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");

function Fixture() {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return <Messages selected={state.selected} value={state.conversations[state.selected ?? ""]}
    pendingRequest={state.pendingRequest} />;
}

beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockImplementation(async (callback) => {
    receive = callback;
    return vi.fn<() => void>();
  });
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "imagePreview") return { url: "data:image/png;base64,cGljdHVyZQ==" };
    if (request.operation === "models") return { data: testModels, nextCursor: null };
    if (request.operation === "list") return { data: [], nextCursor: null };
    return { thread: { ...thread, turns: [] } };
  });
  controller = new GuiController();
  await controller.connect();
  await controller.select(thread.id);
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root.render(<Fixture />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  controller.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

it.each(["batch", "steer"])("shows %s queue messages on acknowledgement before server items arrive", async (mode) => {
  const live = { id: "live", status: "inProgress", items: [items[0]] };
  const targetId = mode === "batch" ? "batch" : live.id;
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  vi.mocked(guiApi.request).mockImplementation(async (request) => request.operation === "sendBatch"
    ? { turn: { id: targetId, status: "inProgress", items: [] } } : original(request));
  await act(async () => {
    receive({ method: "turn/started", params: { threadId: thread.id, turn: live } });
    await controller.send("也检查待发送消息", []);
  });
  expect(container.textContent).not.toContain("也检查待发送消息");
  await act(async () => {
    if (mode === "steer") await controller.queue.steer(thread.id, controller.getSnapshot().queued.one[0].id);
    else receive({ method: "turn/completed", params: { threadId: thread.id, turn: { ...live, status: "completed" } } });
  });
  expect(controller.getSnapshot().queued.one).toEqual([]);
  const visibleCount = () => container.textContent?.split("也检查待发送消息").length;
  expect(visibleCount()).toBe(2);
  const delivered: Item = { id: "delivered", type: "userMessage",
    content: [{ type: "text", text: "也检查待发送消息" }] };
  await act(async () => {
    for (const method of ["item/started", "item/completed"]) receive({ method,
      params: { threadId: thread.id, turnId: targetId, item: delivered } });
  });
  expect(visibleCount()).toBe(2);
});

it("renders deltas between arrivals, preserves code blocks, and flushes when stopped", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const params = { threadId: thread.id, turnId: "live", itemId: "reply" };
  await act(async () => {
    receive({ method: "turn/started", params: { threadId: thread.id,
      turn: { id: "live", status: "inProgress", items: [] } } });
    receive({ method: "item/started", params: { ...params,
      item: { id: "reply", type: "agentMessage", text: "```text\n开始\n" } } });
  });
  const codeBlock = container.querySelector("pre");
  expect(codeBlock?.textContent).toContain("开始");
  const delta = "连续输出的文字".repeat(20);
  await act(async () => receive({ method: "item/agentMessage/delta", params: { ...params, delta } }));
  await act(async () => { vi.advanceTimersByTime(32); });
  await act(async () => { vi.advanceTimersByTime(32); });
  const intermediate = codeBlock!.textContent!;
  expect(intermediate.length).toBeGreaterThan("开始\n".length);
  expect(intermediate).not.toContain(delta);
  expect(container.querySelector("pre")).toBe(codeBlock);
  await act(async () => { vi.advanceTimersByTime(32); });
  expect(codeBlock!.textContent!.length).toBeGreaterThan(intermediate.length);
  await act(async () => receive({ method: "turn/completed", params: { threadId: thread.id,
    turn: { id: "live", status: "interrupted", items: [] } } }));
  expect(codeBlock!.textContent).toContain(delta);
  expect(container.textContent).toContain("已停止生成");
  expect(container.querySelector("[data-processing-phase]")).toBeNull();
});

function expectHistory() {
  expect(container.textContent).toContain("检查这个项目");
  expect(guiApi.request).toHaveBeenCalledWith({ operation: "imagePreview", threadId: "one",
    source: "D:/screenshot.png", variant: "thumbnail" });
  expect(container.querySelector('img[alt="图片附件 1"]')?.getAttribute("src"))
    .toBe("data:image/png;base64,cGljdHVyZQ==");
  expect(container.textContent).toContain("先检查项目的测试结果");
  expect(container.textContent).toContain("PASS: project tests");
  expect(container.textContent).toContain("项目检查通过");
  expect(container.querySelectorAll("article")).toHaveLength(2);
}

async function openHistory() {
  for (let level = 0; level < 2; level++) {
    await act(async () => container.querySelectorAll<HTMLDetailsElement>("details:not([open])").forEach((entry) => {
      entry.open = true;
      entry.dispatchEvent(new Event("toggle"));
    }));
  }
}

it("keeps visible messages and expanded activity after completion, reopening, and continuing", async () => {
  await act(async () => {
    receive({ method: "turn/started", params: { threadId: thread.id,
      turn: { id: "turn", status: "inProgress", items: [] } } });
    for (const item of items) receive({ method: "item/completed", params: {
      threadId: thread.id, turnId: "turn", item } });
  });
  await openHistory();
  const activity = container.querySelectorAll("details")[1];
  await act(async () => receive({ method: "turn/completed", params: { threadId: thread.id,
    turn: { id: "turn", status: "completed", items: [items[3]] } } }));
  expectHistory();
  expect(container.querySelectorAll("details")[1]).toBe(activity);
  expect(activity.open).toBe(true);
  expect(container.querySelector("[data-processing-phase]")).toBeNull();

  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "imagePreview") return { url: "data:image/png;base64,cGljdHVyZQ==" };
    if (request.operation === "list") return { data: [thread], nextCursor: null };
    if (request.operation === "send") return { turn: { id: "next", status: "inProgress", items: [] } };
    return { thread };
  });
  await act(async () => controller.newConversation());
  await act(async () => controller.select(thread.id));
  expect(container.textContent).not.toContain("PASS: project tests");
  await openHistory();
  expectHistory();
  await act(async () => { expect(await controller.send("继续检查", [])).toBe(true); });
  expectHistory();
  expect(container.querySelector("[data-processing-phase]")?.textContent).toContain("等待响应");
});

it("renders Markdown photos and lets failed images retry without changing the reply", async () => {
  const text = "![新加坡滨海湾](https://example.com/singapore.jpg)\n\n图片来源";
  const value = conversation({ ...thread, turns: [{ id: "images", status: "completed", items: [
    { id: "photo", type: "agentMessage", text },
  ] }] });
  await act(async () => root.render(<Messages selected={thread.id} value={value} />));
  const image = container.querySelector("img")!;
  expect(image.getAttribute("src")).toBe("https://example.com/singapore.jpg");
  expect(image.alt).toBe("新加坡滨海湾");
  expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(container.querySelector('button[aria-label="放大查看：新加坡滨海湾"]')).not.toBeNull();
  await act(async () => image.dispatchEvent(new Event("error")));
  expect(container.querySelector('[role="status"]')?.textContent).toContain("图片加载失败");
  await act(async () => (container.querySelector('[role="status"] button') as HTMLButtonElement).click());
  expect(container.querySelector("img")?.src).toBe(image.src);
  expect(container.textContent).toContain("图片来源");
});

it("does not load local endpoints or executable URLs as Markdown images", async () => {
  const value = conversation({ ...thread, turns: [{ id: "unsafe", status: "completed", items: [
    { id: "photo", type: "agentMessage",
      text: "![本地](/__codex_switch__/api/invoke) ![脚本](javascript:alert%281%29)" },
  ] }] });
  await act(async () => root.render(<Messages selected={thread.id} value={value} />));
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("暂不支持预览");
});

it("places the real send date and time beside the copy action outside the user bubble", async () => {
  const startedAt = 1788873505;
  const value = conversation({ ...thread, turns: [{ id: "timed", status: "completed", startedAt,
    items: [items[0]] }] });
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await act(async () => root.render(<Messages selected={thread.id} value={value} />));
  const article = container.querySelector("article")!;
  const bubble = article.firstElementChild!;
  const time = article.querySelector("time")!;
  const copy = article.querySelector<HTMLButtonElement>('[aria-label="复制消息"]')!;
  expect(time.dateTime).toBe(new Date(startedAt * 1000).toISOString());
  expect(time.textContent).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
  expect(bubble.contains(time)).toBe(false);
  expect(bubble.contains(copy)).toBe(false);
  expect(time.parentElement).toBe(copy.parentElement);
  await act(async () => copy.click());
  expect(writeText).toHaveBeenCalledWith("检查这个项目");
  expect(copy.getAttribute("aria-label")).toBe("已复制");
});

it("does not invent a send time when older history has no timestamp", async () => {
  await act(async () => root.render(<Messages selected={thread.id} value={conversation(thread)} />));
  expect(container.querySelector("time")).toBeNull();
});

it("hides the continue instruction during streaming and after reopening history", async () => {
  const stopped: Turn = { id: "stopped", status: "interrupted", items: [items[0]] };
  const instruction: Item = { id: "continue", type: "userMessage",
    content: [{ type: "text", text: CONTINUE_MESSAGE }] };
  const continued: Turn = { id: "continued", status: "completed", items: [instruction, items[3]] };
  await act(async () => {
    receive({ method: "turn/completed", params: { threadId: thread.id, turn: stopped } });
    receive({ method: "turn/started", params: { threadId: thread.id,
      turn: { ...continued, status: "inProgress", items: [] } } });
    receive({ method: "item/completed", params: { threadId: thread.id, turnId: continued.id, item: instruction } });
  });
  expect(container.textContent).not.toContain(CONTINUE_MESSAGE);
  expect(container.textContent).toContain("检查这个项目");
  expect(container.querySelector("[data-processing-phase]")?.textContent).toContain("等待响应");
  await act(async () => receive({ method: "turn/completed", params: { threadId: thread.id, turn: continued } }));
  vi.mocked(guiApi.request).mockImplementation(async (request) => request.operation === "read"
    ? { thread: { ...thread, turns: [stopped, continued] } } : { data: [], nextCursor: null });
  await act(async () => controller.newConversation());
  await act(async () => controller.select(thread.id));
  expect(container.textContent).not.toContain(CONTINUE_MESSAGE);
  expect(container.textContent).toContain("项目检查通过");
  expect(controller.getSnapshot().conversations.one.turns[1].items).toContainEqual(instruction);
});

it("keeps normal continuation requests, attachments, and later steering visible", async () => {
  const instruction: Item = { id: "input", type: "userMessage",
    content: [{ type: "text", text: CONTINUE_MESSAGE }] };
  const ordinary = conversation({ ...thread, turns: [{ id: "ordinary", status: "completed", items: [instruction] }] });
  await act(async () => root.render(<Messages selected={thread.id} value={ordinary} />));
  expect(container.textContent).toContain(CONTINUE_MESSAGE);
  const value = conversation({ ...thread, turns: [
    { id: "stopped", status: "interrupted", items: [] },
    { id: "next", status: "completed", items: [
      { ...instruction, content: [{ type: "text", text: "继续检查测试结果" }] },
      { ...instruction, id: "steering" },
      { ...instruction, id: "attachment", content: [{ type: "text", text: CONTINUE_MESSAGE },
        { type: "localImage", path: "D:/reference.png" }] },
    ] },
  ] });
  await act(async () => root.render(<Messages selected={thread.id} value={value} />));
  expect(container.textContent).toContain("继续检查测试结果");
  expect(container.textContent).toContain(CONTINUE_MESSAGE);
  expect(guiApi.request).toHaveBeenCalledWith({ operation: "imagePreview", threadId: "one",
    source: "D:/reference.png", variant: "thumbnail" });
  expect(container.querySelector('img[alt="图片附件 1"]')?.getAttribute("src"))
    .toBe("data:image/png;base64,cGljdHVyZQ==");
  expect(container.querySelectorAll("article")).toHaveLength(3);
});
