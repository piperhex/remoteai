// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetailsWorkspace } from "../../../../../shared/conversation/DetailsWorkspace";
import { DiffView } from "./DiffView";
import { changedFiles } from "../../../../../shared/conversation/diff";

let root: Root;
let container: HTMLDivElement;
const files = changedFiles([{ path: "example.ts", kind: { type: "update" },
  diff: "@@ -1 +1 @@\n-const value = 1;\n+const value = 2;\n" }]);
const originalCapture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "setPointerCapture");

function Fixture({ selected = "one", changes = files }: { selected?: string; changes?: typeof files }) {
  return <DetailsWorkspace selected={selected} active>
    <p>对话正文</p><DiffView files={changes} title="本轮修改" />
  </DetailsWorkspace>;
}
const button = (label: string) => container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
const panel = () => container.querySelector('aside[aria-label="文件更改详情"]') as HTMLElement;
const trigger = () => container.querySelector('button[aria-label^="查看本轮修改"]') as HTMLButtonElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1200, 800));
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: vi.fn() });
  localStorage.clear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalCapture) Object.defineProperty(HTMLElement.prototype, "setPointerCapture", originalCapture);
  else Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture");
});

it("opens diff in a right panel and preserves layout when minimized, restored, and expanded", async () => {
  expect(container.querySelector("code")).toBeNull();
  trigger().focus();
  await act(async () => trigger().click());
  expect(panel().hidden).toBe(false);
  expect(panel().style.width).toBe("560px");
  expect(panel().textContent).toContain("const value = 2;");
  expect(panel().querySelector(".hljs-keyword")?.textContent).toBe("const");
  expect(document.activeElement).toBe(button("关闭详情抽屉"));
  const split = [...panel().querySelectorAll("button")].find((node) => node.textContent === "并排")!;
  await act(async () => split.click());
  await act(async () => button("最小化详情抽屉").click());
  expect(panel().hidden).toBe(true);
  await act(async () => [...container.querySelectorAll("button")].find((node) =>
    node.textContent === "恢复文件更改")!.click());
  expect(split.getAttribute("aria-pressed")).toBe("true");
  await act(async () => button("展开详情抽屉").click());
  expect(panel().style.width).toBe("1200px");
  await act(async () => button("还原抽屉宽度").click());
  expect(panel().style.width).toBe("560px");
  await act(async () => panel().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(panel().hidden).toBe(true);
  expect(document.activeElement).toBe(trigger());
});

it("drags its left edge, persists width, supports keyboard resizing, and cleans up pointer state", async () => {
  await act(async () => trigger().click());
  const grip = container.querySelector('[role="separator"]')!;
  const pointer = async (type: string, clientX: number) => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX });
    Object.defineProperty(event, "pointerId", { value: 1 });
    await act(async () => grip.dispatchEvent(event));
  };
  await pointer("pointerdown", 600); await pointer("pointermove", 480); await pointer("pointerup", 480);
  expect(panel().style.width).toBe("680px");
  expect(localStorage.getItem("codex-switch:gui-details-width")).toBe("680");
  expect(document.body.style.cursor).not.toBe("col-resize");
  await act(async () => grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(panel().style.width).toBe("656px");
  await pointer("pointerdown", 500); await pointer("pointermove", 450);
  expect(document.body.style.userSelect).toBe("none");
  await act(async () => button("关闭详情抽屉").click());
  expect(document.body.style.userSelect).not.toBe("none");
});

it("updates an open live diff and clears it when switching conversations", async () => {
  await act(async () => trigger().click());
  const updated = changedFiles([{ path: "example.ts", kind: { type: "add" }, diff: "streamed update\n" }]);
  await act(async () => root.render(<Fixture changes={updated} />));
  expect(panel().textContent).toContain("streamed update");
  await act(async () => root.render(<Fixture changes={updated} selected="two" />));
  expect(panel()).toBeNull();
});

it("previews three files, expands the remainder, and reviews every file", async () => {
  const changes = Array.from({ length: 17 }, (_, index) => ({ ...files[0], path: `src/file-${index}.ts` }));
  await act(async () => root.render(<Fixture changes={changes} />));
  const card = container.querySelector('section[aria-label="本轮修改"]')!;
  const toggle = () => card.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  expect(card.textContent).toContain("已编辑 17 个文件");
  expect(card.querySelector('[aria-label="新增 17 行，删除 17 行"]')).not.toBeNull();
  expect(card.querySelectorAll("li")).toHaveLength(3);
  expect(toggle().textContent).toBe("再显示 14 个文件");
  expect(toggle().getAttribute("aria-expanded")).toBe("false");
  await act(async () => toggle().click());
  expect(card.querySelectorAll("li")).toHaveLength(17);
  expect(toggle().getAttribute("aria-expanded")).toBe("true");
  await act(async () => toggle().click());
  expect(card.querySelectorAll("li")).toHaveLength(3);
  await act(async () => trigger().click());
  expect(panel().textContent).toContain("file-16.ts");
});

it.each([1, 3])("does not offer expansion for %i distinct files", async (count) => {
  const changes = Array.from({ length: count }, (_, index) => ({ ...files[0], path: `src/file-${index}.ts` }));
  await act(async () => root.render(<Fixture changes={[...changes, changes[0]]} />));
  const card = container.querySelector('section[aria-label="本轮修改"]')!;
  expect(card.textContent).toContain(`已编辑 ${count} 个文件`);
  expect(card.querySelectorAll("li")).toHaveLength(count);
  expect(card.querySelector("button[aria-expanded]")).toBeNull();
  expect(card.querySelector("li")?.textContent).toContain("+2−2");
});

function fileTrigger(path: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('section[aria-label="本轮修改"] li button')]
    .find((node) => node.textContent === path)!;
}

it("opens the clicked full path directly and keeps review scoped to all files", async () => {
  const path = "F:\\projects\\codex-switch\\src\\example.ts";
  const changes = changedFiles([
    { path: "other/example.ts", kind: { type: "add" }, diff: "unrelated code\n" },
    { path, kind: { type: "add" }, diff: "selected code\n" },
  ]);
  await act(async () => root.render(<Fixture changes={changes} />));
  const selected = fileTrigger(path);
  selected.focus();
  await act(async () => selected.click());
  expect([...panel().querySelectorAll('[aria-label]')].some((node) =>
    node.getAttribute("aria-label") === `${path} 的代码差异`)).toBe(true);
  expect(panel().textContent).toContain(path);
  expect(panel().textContent).toContain("selected code");
  expect(panel().textContent).not.toContain("other/example.ts");
  expect(panel().textContent).not.toContain("unrelated code");
  expect(panel().querySelector('button[aria-expanded="true"]')).not.toBeNull();
  await act(async () => button("关闭详情抽屉").click());
  expect(document.activeElement).toBe(selected);
  await act(async () => trigger().click());
  expect(panel().textContent).toContain("2 个文件");
  expect(panel().textContent).toContain("unrelated code");
});

it("shows every edit to a selected file, keeps live updates scoped, and reopens collapsed diffs", async () => {
  const changes = changedFiles([
    { path: "first.ts", kind: { type: "add" }, diff: "first file\n" },
    { path: "target.ts", kind: { type: "add" }, diff: "initial change\n" },
    { path: "target.ts", kind: { type: "update" }, diff: "@@ -1 +1 @@\n-initial change\n+later change\n" },
  ]);
  await act(async () => root.render(<Fixture changes={changes} />));
  await act(async () => fileTrigger("target.ts").click());
  expect(panel().querySelectorAll('button[aria-expanded="true"]')).toHaveLength(2);
  expect(panel().textContent).toContain("later change");
  const updated = changedFiles([{ path: "target.ts", kind: { type: "add" }, diff: "live change\n" }]);
  await act(async () => root.render(<Fixture changes={[changes[0], ...updated]} />));
  expect(panel().textContent).toContain("live change");
  expect(panel().textContent).not.toContain("first file");
  await act(async () => panel().querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
  expect(panel().textContent).not.toContain("live change");
  await act(async () => fileTrigger("target.ts").click());
  expect(panel().textContent).toContain("live change");
  await act(async () => fileTrigger("first.ts").click());
  expect(panel().textContent).toContain("first file");
  expect(panel().textContent).not.toContain("live change");
});
