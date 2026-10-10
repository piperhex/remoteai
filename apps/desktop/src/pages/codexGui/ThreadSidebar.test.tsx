// @vitest-environment jsdom
import { act } from "react";
import { App, ConfigProvider } from "antd";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GuiController } from "./controller";
import { guiApi } from "./api";
import { ThreadSidebar } from "./ThreadSidebar";
import { initialState } from "./preferences";
import { conversation } from "./events";
import type { GuiState } from "./types";
import styles from "./styles.module.less";

let root: Root;
let container: HTMLDivElement;
let controller: GuiController;
let state: GuiState;
const render = () => act(async () => root.render(<ConfigProvider theme={{ token: { motion: false } }}>
  <App><ThreadSidebar state={state} controller={controller} accountPicker={null}
    focused={false} onToggleFocus={vi.fn()} /></App>
</ConfigProvider>));
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find((entry) => entry.textContent === text)!;
const openThreadMenu = () => act(async () => {
  button("会话示例").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => getComputedStyle(element));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener() {}, removeListener() {} })));
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  controller = new GuiController();
  state = { ...initialState(), connection: "ready",
    threads: [{ id: "one", cwd: "D:/project", preview: "会话示例", updatedAt: 1, turns: [] }] };
  vi.spyOn(controller, "deleteThread").mockResolvedValue(true);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); controller.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("offers a compact confirmation and sends the selected conversation to trash", async () => {
  await render();
  await openThreadMenu();
  const remove = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((entry) => entry.textContent === "删除")!;
  expect(remove).toBeTruthy();
  await act(async () => remove.click());
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.style.width).toBe("400px");
  expect(dialog.textContent).toContain("会话管理");
  expect(dialog.textContent).toContain("这条对话及其所有子对话将一起移入回收站");
  await act(async () => button("移入回收站").click());
  expect(controller.deleteThread).toHaveBeenCalledWith("one");
});

it("disables deletion while Codex reports an active reply", async () => {
  state.threads[0].status = { type: "active" };
  await render();
  await openThreadMenu();
  const remove = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((entry) => entry.textContent === "删除")!;
  expect(remove.getAttribute("aria-disabled")).toBe("true");
  expect(controller.deleteThread).not.toHaveBeenCalled();
});

it("places create branch above archive and branches the right-clicked conversation", async () => {
  const fork = vi.spyOn(controller, "forkConversation").mockResolvedValue(true);
  const select = vi.spyOn(controller, "select").mockResolvedValue();
  await render();
  await openThreadMenu();
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  expect(items.map((entry) => entry.textContent)).toEqual(["置顶", "重命名", "创建分支", "归档", "删除"]);
  await act(async () => items.find((entry) => entry.textContent === "创建分支")!.click());
  expect(fork).toHaveBeenCalledExactlyOnceWith("one");
  expect(select).not.toHaveBeenCalled();
});

it.each<Partial<GuiState>>([
  { connection: "offline" }, { forking: "other" }, { sending: true }, { archived: true },
  { compacting: "one" }, { pendingRequest: { threadId: "one", startedAtMs: 1 } },
  { threads: [{ id: "one", cwd: "D:/project", preview: "会话示例", updatedAt: 1, status: { type: "active" } }] },
])("disables branching while the conversation is unavailable: %j", async (patch) => {
  const fork = vi.spyOn(controller, "forkConversation").mockResolvedValue(true);
  state = { ...state, ...patch };
  await render();
  await openThreadMenu();
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((entry) => entry.textContent === "创建分支")!;
  expect(item.getAttribute("aria-disabled")).toBe("true");
  await act(async () => item.click());
  expect(fork).not.toHaveBeenCalled();
});

it("selects on left click and opens management actions only on right click", async () => {
  const select = vi.spyOn(controller, "select").mockResolvedValue();
  const pin = vi.spyOn(controller, "pin");
  await render();
  expect(container.querySelector('[aria-label="管理对话：会话示例"]')).toBeNull();
  await act(async () => button("会话示例").click());
  expect(select).toHaveBeenCalledExactlyOnceWith("one");
  expect(document.querySelector('[role="menu"]')).toBeNull();
  select.mockClear();
  await openThreadMenu();
  expect(select).not.toHaveBeenCalled();
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find((entry) => entry.textContent === "置顶")!;
  await act(async () => item.click());
  expect(pin).toHaveBeenCalledWith("one");
});

it("starts a new chat in the clicked project without moving the current conversation or toggling its folder", async () => {
  const previous = { ...state.threads[0], id: "previous", cwd: "D:/other" };
  vi.spyOn(guiApi, "request").mockImplementation(async (request) => {
    if (request.operation === "read") return { thread: previous };
    return { goals: [] };
  });
  await controller.select(previous.id);
  controller.settings({ cwd: previous.cwd });
  state = { ...state, selected: previous.id, archived: true };
  await render();
  const heading = button("project");
  await act(async () => heading.click());
  const add = container.querySelector<HTMLButtonElement>('[aria-label="在 project 中新建对话"]')!;
  await act(async () => add.click());
  expect(heading.getAttribute("aria-expanded")).toBe("false");
  expect(controller.getSnapshot().selected).toBeNull();
  expect(controller.getSnapshot().archived).toBe(false);
  expect(controller.getSnapshot().settings.cwd).toBe("D:/project");
  expect(controller.getSnapshot().projectOverrides).toEqual({});
  expect(controller.getSnapshot().conversations.previous.thread.cwd).toBe("D:/other");
  expect(new GuiController().getSnapshot().settings.cwd).toBe("D:/project");
});

it("offers pin and remove actions on projects while keeping the recent group unmanaged", async () => {
  state.threads.push({ ...state.threads[0], id: "recent", cwd: "" });
  const pin = vi.spyOn(controller.projectActions, "pin");
  const remove = vi.spyOn(controller.projectActions, "remove").mockResolvedValue(true);
  await render();
  expect(container.querySelector('section[aria-label="最近"]')).toBeTruthy();
  expect(container.querySelector('[aria-label="管理项目：最近"]')).toBeNull();
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="管理项目：project"]')!;
  const choose = async (label: string) => {
    await act(async () => trigger.click());
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((entry) => entry.textContent === label)!;
    await act(async () => item.click());
  };
  await choose("置顶");
  expect(pin).toHaveBeenCalledWith("D:/project");
  state = { ...state, pinnedProjects: ["D:/project"] };
  await render();
  await choose("取消置顶");
  expect(controller.getSnapshot().pinnedProjects).toEqual([]);
  await choose("移除项目");
  expect(remove).toHaveBeenCalledWith("D:/project");
  expect(button("project").getAttribute("aria-expanded")).toBe("true");
});

it("shows a spinner for active chats, a dot for completed unread chats, and no dot for read chats", async () => {
  state.threadReadState.one = { turnId: "turn", unread: true };
  state.threads[0].status = { type: "active" };
  await render();
  expect(container.querySelector('[aria-label="正在回复"]')).toBeTruthy();
  expect(container.querySelector('[aria-label="未读回复"]')).toBeNull();
  state = { ...state, threads: [{ ...state.threads[0], status: { type: "idle" } }] };
  await render();
  expect(container.querySelector('[aria-label="正在回复"]')).toBeNull();
  expect(container.querySelector('[aria-label="未读回复"]')).toBeTruthy();
  state = { ...state, threadReadState: { one: { turnId: "turn", unread: false } } };
  await render();
  expect(container.querySelector('[aria-label="未读回复"]')).toBeNull();
});

function scrollList() {
  const list = container.querySelector<HTMLDivElement>(`.${styles.threadList}`)!;
  Object.defineProperties(list, { clientHeight: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: 1000 } });
  const scroll = (top: number) => act(async () => {
    list.scrollTop = top;
    list.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const wheel = (deltaY: number) => act(async () => {
    list.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY }));
  });
  return { list, scroll, wheel };
}

it("loads near the bottom without a button and keeps rapid scrolling single-flight", async () => {
  let finish!: () => void;
  const refresh = vi.spyOn(controller, "refresh").mockImplementation(() => new Promise<void>((resolve) => {
    finish = resolve;
  }));
  state = { ...state, cursor: "next" };
  await render();
  expect(button("加载更多")).toBeUndefined();
  expect(container.textContent).toContain("向下滚动，查看更多");
  const { scroll, wheel } = scrollList();
  await scroll(200);
  expect(refresh).not.toHaveBeenCalled();
  await scroll(490);
  await scroll(510);
  await wheel(50);
  expect(refresh).toHaveBeenCalledExactlyOnceWith(true);
  state = { ...state, loading: true };
  await render();
  expect(container.querySelector('[role="status"]')?.textContent).toContain("正在加载更多对话…");
  await act(async () => finish());
  state = { ...state, loading: false, cursor: "next-page" };
  await render();
  await scroll(520);
  expect(refresh).toHaveBeenCalledTimes(2);
  await act(async () => finish());
});

it("ignores upward scrolling and pauses pagination while loading, disconnected, or exhausted", async () => {
  const refresh = vi.spyOn(controller, "refresh").mockResolvedValue();
  state = { ...state, cursor: "next", loading: true };
  await render();
  const { scroll, wheel } = scrollList();
  await scroll(500);
  state = { ...state, loading: false };
  await render();
  await scroll(490);
  await wheel(-50);
  state = { ...state, connection: "offline" };
  await render();
  await wheel(50);
  state = { ...state, connection: "ready", cursor: null };
  await render();
  await wheel(50);
  expect(refresh).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("向下滚动，查看更多");
});

it("loads on downward wheel gestures even when collapsed groups do not fill the list", async () => {
  const refresh = vi.spyOn(controller, "refresh").mockResolvedValue();
  state = { ...state, cursor: "next", archived: true };
  await render();
  const { list, wheel } = scrollList();
  Object.defineProperty(list, "scrollHeight", { value: 400 });
  await wheel(50);
  expect(refresh).toHaveBeenCalledExactlyOnceWith(true);
});


it("opens feature pages during a reply without creating or changing a conversation", async () => {
  const onNavigate = vi.fn();
  const start = vi.spyOn(controller, "newConversation");
  const select = vi.spyOn(controller, "select").mockResolvedValue();
  state = { ...state, selected: "one", sending: true };
  await act(async () => root.render(<App><ThreadSidebar state={state} controller={controller}
    accountPicker={null} focused={false} onToggleFocus={vi.fn()} view="plugins" onNavigate={onNavigate} /></App>));
  expect(button("新对话").disabled).toBe(true);
  expect(button("插件").getAttribute("aria-current")).toBe("page");
  expect(button("会话示例").closest("." + styles.selected)).toBeNull();
  await act(async () => button("定时任务").click());
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith("scheduled-tasks");
  const navigation = container.querySelector('nav[aria-label="Codex GUI 导航"]')!;
  expect([...navigation.querySelectorAll("button")].map((entry) => entry.textContent))
    .toEqual(["新对话", "定时任务", "插件", "对话迁移"]);
  await act(async () => button("对话迁移").click());
  expect(onNavigate).toHaveBeenLastCalledWith("conversation-migration");
  expect(start).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
});

it.each(["D:/project", ""])("temporarily promotes running chats within %j before folding older rows", async (cwd) => {
  state = { ...state, threads: Array.from({ length: 7 }, (_, index) => ({
    id: `chat-${index}`, cwd, name: `聊天 ${index}`, preview: "", updatedAt: 7 - index,
  })) };
  const titles = () => [...container.querySelectorAll(`.${styles.threadTitle}`)].map((entry) => entry.textContent);
  await render();
  expect(titles()).toEqual(["聊天 0", "聊天 1", "聊天 2", "聊天 3", "聊天 4"]);
  state = { ...state, pendingRequest: { threadId: "chat-6", startedAtMs: 1 } };
  await render();
  expect(titles()).toEqual(["聊天 6", "聊天 0", "聊天 1", "聊天 2", "聊天 3"]);
  state = { ...state, pendingRequest: undefined, conversations: {
    "chat-6": { ...conversation(state.threads[6]), activeTurn: "turn" },
  } };
  await render();
  expect(titles()[0]).toBe("聊天 6");
  state = { ...state, threads: state.threads.map((thread) => thread.id === "chat-5"
    ? { ...thread, status: { type: "active" } } : thread) };
  await render();
  expect(titles()).toEqual(["聊天 5", "聊天 6", "聊天 0", "聊天 1", "聊天 2"]);
  await act(async () => button("展开显示").click());
  state = { ...state, conversations: {}, threads: state.threads.map((thread) => ({
    ...thread, status: { type: "idle" },
  })) };
  await render();
  expect(titles()).toEqual(Array.from({ length: 7 }, (_, index) => `聊天 ${index}`));
  expect(state.threads.map((thread) => thread.id)).toEqual(Array.from({ length: 7 }, (_, index) => `chat-${index}`));
});

it("returns to the conversation when selecting the already selected thread from a feature page", async () => {
  const onNavigate = vi.fn();
  const select = vi.spyOn(controller, "select").mockResolvedValue();
  state = { ...state, selected: "one" };
  await act(async () => root.render(<App><ThreadSidebar state={state} controller={controller}
    accountPicker={null} focused={false} onToggleFocus={vi.fn()} view="scheduled-tasks"
    onNavigate={onNavigate} /></App>));
  await act(async () => button("会话示例").click());
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith("conversation");
  expect(select).toHaveBeenCalledExactlyOnceWith("one");
});
