// @vitest-environment jsdom
import { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "./api";
import { testModels } from "./testModels";
import { GuiController } from "./controller";
import { ComposerSubmit } from "./ComposerSubmit";
import type { GuiEvent, Thread, Turn } from "./types";

vi.mock("./api", () => ({ guiApi: {
  connect: vi.fn(), request: vi.fn(), subscribe: vi.fn(), respond: vi.fn(),
} }));
const stopped: Turn = { id: "stopped", status: "interrupted", items: [
  { id: "question", type: "userMessage", content: [{ type: "text", text: "搜索今天的新闻" }] },
] };
const thread: Thread = { id: "one", cwd: "", preview: "搜索今天的新闻", updatedAt: 1, turns: [stopped] };
let root: Root;
let container: HTMLDivElement;
let controller: GuiController;
let receive: (event: GuiEvent) => void;
let hasDraft: boolean;
let reading: boolean;
const onSend = vi.fn(async () => {});

function Fixture() {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return <ComposerSubmit state={state} controller={controller}
    hasDraft={hasDraft} reading={reading} onSend={onSend} />;
}

const render = () => act(async () => root.render(<Fixture />));
const button = () => container.querySelector("button")!;
const click = () => act(async () => button().click());

beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  hasDraft = false;
  reading = false;
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockImplementation(async (callback) => {
    receive = callback;
    return vi.fn<() => void>();
  });
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "models") return { data: testModels, nextCursor: null };
    if (request.operation === "list") return { data: [], nextCursor: null };
    if (request.operation === "send") return { turn: { id: "next", status: "inProgress", items: [] } };
    if (request.operation === "interrupt") receive({ method: "turn/completed",
      params: { threadId: thread.id, turn: stopped } });
    return { thread };
  });
  controller = new GuiController();
  await controller.connect();
  await controller.select(thread.id);
  container = document.createElement("div");
  root = createRoot(container);
  await render();
});

afterEach(async () => {
  await act(async () => root.unmount());
  controller.dispose();
  vi.unstubAllGlobals();
});

it("changes stop to play and continues in the same conversation only once on a double click", async () => {
  await act(async () => receive({ method: "turn/started", params: {
    threadId: thread.id, turn: { ...stopped, status: "inProgress" },
  } }));
  expect(button().getAttribute("aria-label")).toBe("停止生成");
  await click();
  expect(guiApi.request).toHaveBeenCalledWith({ operation: "interrupt", threadId: "one", turnId: "stopped" });
  expect(button().getAttribute("aria-label")).toBe("继续生成");
  expect(button().querySelector(".lucide-play")).not.toBeNull();
  expect(button().disabled).toBe(false);
  await act(async () => { button().click(); button().click(); });
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ operation: "resume", threadId: "one" }));
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({
    operation: "send", threadId: "one", text: "请继续完成刚才中断的任务。", images: [],
  }));
  expect(vi.mocked(guiApi.request).mock.calls.filter(([request]) => request.operation === "send")).toHaveLength(1);
  expect(controller.getSnapshot().conversations.one.turns[0]).toMatchObject(stopped);
  expect(button().getAttribute("aria-label")).toBe("停止生成");
  expect(onSend).not.toHaveBeenCalled();
});

it("sends a draft instead of a continuation and waits for attachments to finish reading", async () => {
  hasDraft = true;
  reading = true;
  await render();
  expect(button().getAttribute("aria-label")).toBe("发送消息");
  expect(button().disabled).toBe(true);
  await click();
  expect(onSend).not.toHaveBeenCalled();
  reading = false;
  await render();
  await click();
  expect(onSend).toHaveBeenCalledOnce();
  expect(guiApi.request).not.toHaveBeenCalledWith(expect.objectContaining({ operation: "send" }));
});

it("queues a draft during generation and shows stop again when the draft is empty", async () => {
  await act(async () => receive({ method: "turn/started", params: {
    threadId: thread.id, turn: { ...stopped, status: "inProgress" },
  } }));
  hasDraft = true;
  await render();
  expect(button().getAttribute("aria-label")).toBe("加入待发送");
  await click();
  expect(onSend).toHaveBeenCalledOnce();
  hasDraft = false;
  await render();
  expect(button().getAttribute("aria-label")).toBe("停止生成");
});

it("keeps the play button available for retry after a failed continuation", async () => {
  vi.mocked(guiApi.request).mockRejectedValueOnce("暂时无法连接，请重试。");
  await click();
  expect(controller.getSnapshot().error).toBe("暂时无法连接，请重试。");
  expect(button().getAttribute("aria-label")).toBe("继续生成");
  expect(button().disabled).toBe(false);
  await click();
  expect(button().getAttribute("aria-label")).toBe("停止生成");
});

it("does not offer continuation for completed or new conversations", async () => {
  await act(async () => receive({ method: "turn/completed", params: {
    threadId: thread.id, turn: { id: "latest", status: "completed", items: [] },
  } }));
  expect(button().getAttribute("aria-label")).toBe("发送消息");
  expect(button().disabled).toBe(true);
  await act(async () => controller.newConversation());
  expect(button().getAttribute("aria-label")).toBe("发送消息");
  expect(button().disabled).toBe(true);
});

it("disables continuation in archived conversations and when disconnected", async () => {
  await act(async () => controller.filter("", true));
  expect(button().disabled).toBe(true);
  await click();
  await act(async () => {
    controller.filter("", false);
    receive({ method: "connection/closed", params: {} });
  });
  expect(button().disabled).toBe(true);
  await click();
  expect(guiApi.request).not.toHaveBeenCalledWith(expect.objectContaining({ operation: "send" }));
});
