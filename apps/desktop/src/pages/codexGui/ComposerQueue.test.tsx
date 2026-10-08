// @vitest-environment jsdom
import { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { GuiController } from "./controller";
import { guiApi } from "./api";
import { testModels } from "./testModels";
import type { GuiEvent, Thread } from "./types";

vi.mock("./api", () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
vi.mock("./UsageStatus", () => ({ UsageStatus: () => null }));
vi.mock("./ProjectPicker", () => ({ ProjectPicker: () => null }));
vi.mock("./AccessPicker", () => ({ AccessPicker: () => null }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));
const thread: Thread = { id: "one", cwd: "", preview: "hello", updatedAt: 1, turns: [] };
let controller: GuiController;
let receive: (event: GuiEvent) => void;
let host: HTMLDivElement;
let root: Root;

function Fixture() {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return <Composer state={state} controller={controller} active />;
}

const editor = () => host.querySelector<HTMLDivElement>('[role="textbox"][aria-label="消息"]')!;
const queued = () => controller.getSnapshot().queued.one ?? [];

beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockImplementation(async (callback) => {
    receive = callback; return vi.fn<() => void>();
  });
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "models") return { data: testModels, nextCursor: null };
    if (request.operation === "list") return { data: [], nextCursor: null };
    return { thread };
  });
  controller = new GuiController();
  await controller.connect();
  await controller.select("one");
  receive({ method: "turn/started", params: { threadId: "one",
    turn: { id: "live", status: "inProgress", items: [] } } });
  await controller.send("待修改的消息", []);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Fixture />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  controller.dispose();
  vi.unstubAllGlobals();
});

it("reorders pending messages with separate arrow buttons and disables queue boundaries", async () => {
  const buttons = (direction: string) => Array.from(host.querySelectorAll<HTMLButtonElement>(
    `[aria-label="${direction}待发送消息"]`));
  expect(buttons("上移")[0].disabled).toBe(true);
  expect(buttons("下移")[0].disabled).toBe(true);
  await act(async () => { await controller.send("第二条", []); });
  expect(buttons("上移").map((button) => button.disabled)).toEqual([true, false]);
  expect(buttons("下移").map((button) => button.disabled)).toEqual([false, true]);
  await act(async () => buttons("下移")[0].click());
  expect(queued().map((message) => message.text)).toEqual(["第二条", "待修改的消息"]);
  await act(async () => buttons("上移")[1].click());
  expect(queued().map((message) => message.text)).toEqual(["待修改的消息", "第二条"]);
});

it("moves a queued message into the focused composer and only queues it again on send", async () => {
  await act(async () => {
    editor().textContent = "将被替换的草稿";
    editor().dispatchEvent(new InputEvent("input", { bubbles: true }));
    host.querySelector<HTMLButtonElement>('[aria-label="待发送消息选项"]')!.click();
  });
  const edit = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    .find((item) => item.textContent === "编辑")!;
  expect(edit).toBeDefined();
  await act(async () => edit.click());
  expect(queued()).toEqual([]);
  expect(host.querySelector('[aria-label="待发送消息"]')).toBeNull();
  expect(host.querySelector('[aria-label="编辑待发送消息"]')).toBeNull();
  expect(editor().textContent).toBe("待修改的消息");
  expect(document.activeElement).toBe(editor());
  const selection = window.getSelection()!;
  const beforeCaret = selection.getRangeAt(0).cloneRange();
  beforeCaret.selectNodeContents(editor());
  beforeCaret.setEnd(selection.anchorNode!, selection.anchorOffset);
  expect(beforeCaret.toString()).toBe("待修改的消息");
  expect(guiApi.request).not.toHaveBeenCalledWith(expect.objectContaining({ operation: "sendBatch" }));
  await act(async () => {
    editor().textContent = "修改后的消息";
    editor().dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
  await act(async () => editor().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(queued().map((message) => message.text)).toEqual(["修改后的消息"]);
  expect(editor().textContent).toBe("");
});
