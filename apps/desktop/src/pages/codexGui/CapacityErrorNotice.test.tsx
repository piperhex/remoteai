// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Messages } from "./Messages";
import { conversation, reduceConversation } from "../../../../../shared/conversation/events";
import { MODEL_CAPACITY_MESSAGE } from "../../../../../shared/conversation/requestError";
import { uiText } from '../../../../../shared/localization/uiText';
import { CONTINUE_MESSAGE } from "../../../../../shared/conversation/continuation";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  vi.unstubAllGlobals();
});

it("shows capacity cards inline with a countdown only on the latest failure, and supports stopping", async () => {
  let value = conversation({ id: "one", cwd: "", preview: "", updatedAt: 1,
    turns: [{ id: "failed", status: "inProgress", items: [] }] });
  const error = { message: MODEL_CAPACITY_MESSAGE };
  value = reduceConversation(value, { method: "error", params: { turnId: "failed", error, willRetry: true } });
  value = reduceConversation(value, { method: "item/completed", params: { turnId: "failed",
    item: { id: "progress", type: "agentMessage", phase: "commentary", text: "读取赛道控件" } } });
  value = reduceConversation(value, { method: "turn/completed", params: {
    turn: { id: "failed", status: "failed", error, items: [] } } });
  const onCancelRetry = vi.fn();
  const render = (seconds: number) => act(async () => root.render(<Messages value={value} selected="one"
    retry={{ threadId: "one", turnId: "failed", seconds }} onCancelRetry={onCancelRetry} />));
  await render(3);
  expect(container.textContent?.split(uiText('client.chat.modelAtCapacity'))).toHaveLength(3);
  expect(container.textContent).not.toContain("查看报错详情");
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(container.textContent).toContain("3 秒后自动重试");
  const progress = container.querySelector('[data-message-id="progress"]')!;
  const countdown = container.querySelector('[role="status"]')!;
  expect(progress.compareDocumentPosition(countdown) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await render(2);
  expect(container.textContent).toContain("2 秒后自动重试");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="停止自动重试"]')!.click());
  expect(onCancelRetry).toHaveBeenCalledOnce();
  await act(async () => root.render(<Messages value={value} selected="one" />));
  expect(container.textContent).not.toContain("秒后自动重试");
  expect(container.textContent).toContain(uiText('client.chat.modelAtCapacity'));
});

it("hides the automatic continuation instruction after a failed turn", async () => {
  const value = conversation({ id: "one", cwd: "", preview: "", updatedAt: 1, turns: [
    { id: "failed", status: "failed", durationMs: 0, error: { message: MODEL_CAPACITY_MESSAGE }, items: [] },
    { id: "retry", status: "completed", items: [
      { id: "continue", type: "userMessage", content: [{ type: "text", text: CONTINUE_MESSAGE }] },
      { id: "answer", type: "agentMessage", text: "已恢复" },
    ] },
  ] });
  await act(async () => root.render(<Messages value={value} selected="one" />));
  expect(container.textContent).not.toContain(CONTINUE_MESSAGE);
  expect(container.textContent).not.toContain("用时");
  expect(container.textContent).toContain("已恢复");
});
