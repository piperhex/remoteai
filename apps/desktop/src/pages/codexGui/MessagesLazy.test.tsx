// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Messages } from "./Messages";
import type { Conversation, Item } from "../../../../../shared/conversation/types";
import { CONTINUE_MESSAGE } from "../../../../../shared/conversation/continuation";

const rendered = vi.hoisted(() => ({ texts: new Set<string>() }));
vi.mock("../../../../../shared/conversation/RichText", () => ({ RichText: ({ text }: { text: string }) => {
  rendered.texts.add(text);
  return <p>{text}</p>;
} }));
let root: Root;
let container: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let serial: number;
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
const item = (index: number): Item => ({ id: `item-${index}`, type: "agentMessage", phase: "final_answer",
  text: `Message ${index}` });
const conversation = (id = "chat"): Conversation => ({ thread: { id, cwd: "", preview: "", updatedAt: 1 },
  activeTurn: null, tokens: 0, error: "", turns: [{ id: "turn", status: "completed",
    items: Array.from({ length: 35 }, (_, index) => item(index)) }] });

beforeEach(() => {
  frames = new Map(); serial = 0; rendered.texts.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++serial, callback); return serial;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("scrollTo", vi.fn());
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  expect(frames.size).toBe(0);
  vi.unstubAllGlobals();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});
const render = (value: Conversation, active = true) => act(async () => root.render(
  <Messages selected={value.thread.id} value={value} active={active} />));
const count = () => container.querySelectorAll("[data-message-id]").length;
const button = () => [...container.querySelectorAll("button")].find((entry) => entry.textContent === "加载更早的消息")!;
async function frame() {
  const callbacks = [...frames.values()]; frames.clear();
  await act(async () => callbacks.forEach((callback) => callback(performance.now())));
}
async function older() { await act(async () => button().click()); await frame(); await frame(); }

it('bounds a continually open conversation, keeps history stable, and returns to the latest window', async () => {
  let value = conversation();
  await render(value);
  for (let index = 35; index < 135; index++) {
    value = { ...value, turns: [{ ...value.turns[0], items: [...value.turns[0].items, item(index)] }] };
    await render(value);
    expect(count()).toBe(10);
  }
  const viewport = container.querySelector('[aria-label="对话消息"]')!;
  Object.defineProperties(viewport, { scrollHeight: { value: 2_000 }, clientHeight: { value: 500 } });
  await older(); await older(); await older();
  expect(count()).toBe(30);
  const first = container.querySelector('[data-message-id]')?.getAttribute('data-message-id');
  value = { ...value, turns: [{ ...value.turns[0], items: [...value.turns[0].items, item(135)] }] };
  await render(value);
  expect(count()).toBe(30);
  expect(container.querySelector('[data-message-id]')?.getAttribute('data-message-id')).toBe(first);
  const latest = [...container.querySelectorAll('button')].find(entry => entry.textContent === '回到最新消息')!;
  await act(async () => latest.click());
  expect(count()).toBe(10);
  expect(container.querySelector('[data-message-id="item-135"]')).not.toBeNull();
  await render(value, false);
  expect(count()).toBe(10);
});

it("mounts only ten rich messages, shows loading before the next batch, and never overlaps batches", async () => {
  await render(conversation());
  expect(count()).toBe(10);
  expect(rendered.texts.size).toBe(10);
  expect(rendered.texts.has("Message 0")).toBe(false);
  const last = container.querySelector('[data-message-id="item-34"]');
  const load = button();
  await act(async () => { load.click(); load.click(); });
  expect(container.textContent).toContain("正在加载更早的消息");
  await frame();
  expect(count()).toBe(10);
  await frame();
  expect(count()).toBe(20);
  expect(container.querySelector('[data-message-id="item-34"]')).toBe(last);
  await older(); expect(count()).toBe(30);
  await older(); expect(count()).toBe(30);
  expect(button()).toBeUndefined();
  expect(container.textContent).toContain('加载更新的消息');
});

it("resets a different conversation, retains same-conversation history, and cancels pending navigation work", async () => {
  const cached = conversation();
  await render(cached); await older(); expect(count()).toBe(20);
  await render(conversation("other")); await render(cached); expect(count()).toBe(10);
  await act(async () => button().click());
  await render(cached, false); expect(frames.size).toBe(0);
  await render(cached); expect(count()).toBe(10);
  await older(); await render(cached, false); await render(cached); expect(count()).toBe(20);
});

it("loads only one batch for repeated upward wheels at the top without a scroll event", async () => {
  await render(conversation());
  const viewport = container.querySelector('[aria-label="对话消息"]')!;
  await act(async () => {
    viewport.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -120 }));
    viewport.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -120 }));
  });
  expect(container.textContent).toContain("正在加载更早的消息");
  await frame(); await frame();
  expect(count()).toBe(20);
});

it("ignores zoom, horizontal wheels, and scrolling inside nested output or away from the top", async () => {
  await render(conversation());
  const viewport = container.querySelector<HTMLElement>('[aria-label="对话消息"]')!;
  const wheel = (node: Element, options: WheelEventInit = {}) => act(async () => {
    node.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -120, ...options }));
  });
  await wheel(viewport, { deltaY: 120 });
  await wheel(viewport, { ctrlKey: true });
  await wheel(viewport, { deltaX: 200 });
  viewport.scrollTop = 200;
  await wheel(viewport);
  viewport.scrollTop = 0;
  const output = container.querySelector<HTMLElement>('[data-message-id] p')!;
  const nested = document.createElement("span");
  output.append(nested);
  Object.defineProperties(output, { scrollHeight: { value: 800 }, clientHeight: { value: 200 } });
  output.style.overflowY = "auto";
  await wheel(nested);
  expect(frames.size).toBe(0);
  expect(count()).toBe(10);
  await wheel(viewport);
  await frame(); await frame();
  expect(count()).toBe(20);
});

it("keeps streamed items and an expanded complete activity group while older messages mount", async () => {
  const value = conversation();
  value.turns[0].items.forEach((entry) => { entry.phase = "commentary"; });
  value.turns.unshift({ id: "earlier", status: "completed", items: Array.from({ length: 35 }, (_, index) => (
    { ...item(index), id: `earlier-${index}` })) });
  await render(value);
  const details = container.querySelector("details")!;
  await act(async () => { details.open = true; details.dispatchEvent(new Event("toggle")); });
  await act(async () => button().click());
  const next = { ...value, turns: [value.turns[0], { ...value.turns[1], items: [...value.turns[1].items, item(35)] }] };
  await render(next);
  expect(count()).toBe(45);
  await frame(); await frame();
  expect(count()).toBe(55);
  expect(container.querySelector("details")).toBe(details);
  expect(details.open).toBe(true);
  expect(container.textContent).toContain("Message 35");
});

it("shows the question and full activity count without mounting thousands of collapsed rich messages", async () => {
  const value = conversation();
  value.turns[0].items = [{ id: "question", type: "userMessage", content: [{ type: "text", text: "检查项目" }] },
    ...Array.from({ length: 2_000 }, (_, index): Item => ({ ...item(index), phase: "commentary" })),
    { ...item(2_000), id: "answer" }];
  await render(value);
  expect(container.querySelector("summary")?.getAttribute("aria-label")).toBe("处理过程，2000 项活动");
  expect(container.querySelector("details")?.open).toBe(false);
  expect(count()).toBe(2);
  expect(container.querySelector('[data-message-id="question"]')).not.toBeNull();
  expect(container.querySelector('[data-message-id="answer"]')).not.toBeNull();
  expect(rendered.texts.has("Message 0")).toBe(false);
  expect(rendered.texts.has("Message 1999")).toBe(false);
  expect(button()).toBeUndefined();
});

it("uses the full turn to distinguish a hidden continuation instruction from later user messages", async () => {
  const value = conversation();
  const instruction: Item = { id: "continue", type: "userMessage",
    content: [{ type: "text", text: CONTINUE_MESSAGE }] };
  value.turns.unshift({ id: "stopped", status: "interrupted", items: [] });
  value.turns[1].items[0] = instruction;
  value.turns[1].items[25] = { ...instruction, id: "steering" };
  await render(value);
  expect(container.textContent).toContain(CONTINUE_MESSAGE);
  expect(container.querySelector('[data-message-id="steering"]')).not.toBeNull();
});

it("does not mount old generated image previews until their history batch is loaded", async () => {
  const value = conversation();
  value.turns[0].items[0] = { id: "generated", type: "imageGeneration", status: "completed", result: "iVBORw0KGgo=" };
  await render(value);
  expect(container.querySelector('[aria-label="生成的图片"]')).toBeNull();
  await older(); await older();
  expect(container.querySelector('[aria-label="生成的图片"]')).toBeNull();
  await older();
  expect(container.querySelector('[aria-label="生成的图片"] img')).not.toBeNull();
});

it('keeps an inspected process expanded when a backend page prepends activities to the same turn', async () => {
  const full = conversation();
  full.turns[0].items.forEach(entry => { entry.phase = 'commentary'; });
  let value = { ...full, turns: [{ ...full.turns[0], items: full.turns[0].items.slice(-10) }],
    historyPage: { hasMore: true } };
  const draw = () => root.render(<Messages selected="chat" value={value} onLoadOlder={async () => {
    value = { ...value, turns: full.turns, historyPage: { hasMore: false } };
    draw();
    return value.turns;
  }} />);
  await act(async () => draw());
  const details = container.querySelector('details')!;
  await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')); });
  await older();
  expect(container.querySelector('details')).toBe(details);
  expect(details.open).toBe(true);
  expect(count()).toBe(35);
  expect(button()).toBeUndefined();
});
