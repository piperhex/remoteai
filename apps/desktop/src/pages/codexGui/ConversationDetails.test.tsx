// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Messages } from "./Messages";
import { conversation, reduceConversation } from "../../../../../shared/conversation/events";
import type { Item, Turn } from "../../../../../shared/conversation/types";

let root: Root;
let container: HTMLDivElement;
const image = "data:image/png;base64,iVBORw0KGgo=";
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

async function render(items: Item[], extra: Partial<Turn> = {}) {
  const value = conversation({ id: "test", cwd: "F:/project", preview: "", updatedAt: 1,
    turns: [{ id: "turn", status: "completed", items, ...extra }] });
  await act(async () => root.render(<Messages selected="test" value={value} />));
}

async function openDetails() {
  for (let level = 0; level < 4; level++) {
    await act(async () => container.querySelectorAll<HTMLDetailsElement>("details:not([open])").forEach((entry) => {
      entry.open = true;
      entry.dispatchEvent(new Event("toggle"));
    }));
  }
}

it("keeps expandable proxy errors inside the affected reply when later replies arrive", async () => {
  let value = conversation({ id: "test", cwd: "", preview: "", updatedAt: 1,
    turns: [{ id: "first", status: "inProgress", items: [] }] });
  value = reduceConversation(value, { method: "error", params: { turnId: "first", willRetry: true,
    error: { message: "HTTP 502 Bad Gateway", additionalDetails: "<script>upstream timed out</script>" } } });
  await act(async () => root.render(<Messages selected="test" value={value} />));
  const notice = container.querySelector<HTMLElement>("[data-request-error]")!;
  const summary = notice.querySelector("summary")!;
  expect(summary.getAttribute("aria-label")).toBe("查看报错详情");
  expect(summary.textContent).toContain("HTTP 502 Bad Gateway");
  expect(notice.querySelector("pre")).toBeNull();
  expect(notice.textContent).not.toContain("Codex 正在重试");
  expect(notice.querySelector("script")).toBeNull();
  await openDetails();
  expect(notice.textContent).toContain("Codex 正在重试");
  expect(notice.querySelector("pre")?.textContent)
    .toBe("HTTP 502 Bad Gateway\n\n<script>upstream timed out</script>");
  expect(container.querySelector("script")).toBeNull();
  value = reduceConversation(value, { method: "turn/completed", params: {
    turn: { id: "first", status: "completed", items: [] } } });
  value = reduceConversation(value, { method: "turn/started", params: {
    turn: { id: "second", status: "inProgress", items: [] } } });
  await act(async () => root.render(<Messages selected="test" value={value} />));
  expect(notice.closest("[data-turn-id]")?.getAttribute("data-turn-id")).toBe("first");
  expect(notice.textContent).toContain("现已恢复");
  expect(summary.textContent).toContain("HTTP 502 Bad Gateway");
  expect(container.querySelector('[data-turn-id="second"] [data-request-error]')).toBeNull();
});

it("keeps commentary in expandable process groups while showing steering and final replies", async () => {
  await render([
    { id: "commentary", type: "agentMessage", phase: "commentary", text: "正在检查" },
    { id: "steer", type: "userMessage", content: [{ type: "text", text: "也检查边界情况" }] },
    { id: "command", type: "commandExecution", command: "npm test", status: "completed", aggregatedOutput: "PASS" },
    { id: "final", type: "agentMessage", phase: "final_answer", text: "检查完成" },
  ]);
  expect(container.querySelectorAll("article")).toHaveLength(2);
  expect(container.textContent).not.toContain("正在检查");
  expect(container.textContent).not.toContain("PASS");
  await openDetails();
  const articles = [...container.querySelectorAll("article")];
  expect(articles[0].closest("details")?.open).toBe(true);
  expect(articles[1].closest("details")).toBeNull();
  expect(articles[2].closest("details")).toBeNull();
  expect(container.textContent).toContain("PASS");
});

it("highlights code safely, preserves GFM tables, and exposes exact code copying", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const code = 'const html = "<script>bad()</script>";';
  await render([{ id: "answer", type: "agentMessage",
    text: `\`\`\`javascript\n${code}\n\`\`\`\n\n|项目|结果|\n|---|---|\n|检查|通过|` }]);
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector(".hljs-keyword")?.textContent).toBe("const");
  expect(container.querySelector("table")?.textContent).toContain("检查通过");
  await act(async () => (container.querySelector('[aria-label="复制代码"]') as HTMLButtonElement).click());
  expect(writeText).toHaveBeenCalledWith(code);
});

it("renders tool inputs, rich outputs, search results, failures, and inline images", async () => {
  await render([
    { id: "input", type: "userMessage", content: [{ type: "image", url: image }] },
    { id: "tool", type: "mcpToolCall", tool: "search", arguments: { query: "test" }, status: "completed",
      result: { content: [{ type: "text", text: "**工具结果**" }], structuredContent: { count: 1 } } },
    { id: "error", type: "dynamicToolCall", tool: "demo", status: "failed", error: { message: "工具执行失败" } },
    { id: "web", type: "webSearch", action: { type: "search", queries: ["查询一", "查询二"] },
      results: [{ title: "官方文档", url: "https://example.com/docs", snippet: "相关说明" }] },
    { id: "generated", type: "imageGeneration", result: "iVBORw0KGgo=", status: "completed" },
  ]);
  await openDetails();
  expect(container.textContent).toContain('"query": "test"');
  expect(container.textContent).toContain('"count": 1');
  expect(container.textContent).not.toContain("工具结果");
  expect(container.textContent).toContain("工具执行失败");
  expect(container.textContent).toContain("查询二");
  expect(container.querySelector('a[href="https://example.com/docs"]')).not.toBeNull();
  expect(container.querySelectorAll(`img[src="${image}"]`)).toHaveLength(2);
});

it("keeps rejected changes out of the applied file summary", async () => {
  await render([{ id: "rejected", type: "fileChange", status: "declined",
    changes: [{ path: "file.txt", kind: { type: "add" }, diff: "new" }] }]);
  await openDetails();
  expect(container.textContent).toContain("已拒绝");
  expect(container.textContent).not.toContain("文件修改记录");
});

it("shows completed imagegen results below the final reply outside collapsed activity", async () => {
  const generated: Item = { id: "generated", type: "imageGeneration", status: "inProgress" };
  const final: Item = { id: "final", type: "agentMessage", phase: "final_answer", text: "已生成卡通小鸟。" };
  await render([generated], { status: "inProgress" });
  expect(container.querySelector('[aria-label="生成的图片"]')).toBeNull();
  const completed = { ...generated, status: "completed", result: "iVBORw0KGgo=",
    savedPath: "C:/generated_images/task/bird.png" };
  await render([completed, final]);
  const gallery = container.querySelector('[aria-label="生成的图片"]')!;
  expect(gallery.querySelector("img")?.getAttribute("src")).toBe(image);
  expect(gallery.closest("details")).toBeNull();
  expect(container.querySelectorAll("img")).toHaveLength(1);
  expect(container.querySelector("article")!.compareDocumentPosition(gallery)
    & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // A fresh render of persisted turn items must restore the same visible result.
  await render([]);
  await render([completed, final]);
  expect(container.querySelector('[aria-label="生成的图片"] img')).not.toBeNull();
});

it("keeps multiple generated images visible but excludes failed generations and viewed inputs", async () => {
  await render([
    { id: "one", type: "imageGeneration", status: "completed", result: "iVBORw0KGgo=" },
    { id: "duplicate", type: "imageGeneration", status: "completed", result: "iVBORw0KGgo=" },
    { id: "two", type: "imageGeneration", status: "completed", imageUrl: "https://example.com/two.png" },
    { id: "failed", type: "imageGeneration", status: "failed", failure: { message: "生成失败" } },
    { id: "view", type: "imageView", imageUrl: "https://example.com/reference.png" },
  ]);
  expect(container.querySelectorAll('[aria-label="生成的图片"] img')).toHaveLength(2);
  await openDetails();
  expect(container.textContent).toContain("生成失败");
});
