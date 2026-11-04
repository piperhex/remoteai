// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DiffView } from "./DiffView";
import { changedFiles } from "../../../../../shared/conversation/diff";

let root: Root;
let container: HTMLDivElement;
let revealEnd: () => void;
const disconnect = vi.fn();
const files = changedFiles([{ path: "src/example.ts", kind: { type: "update" },
  diff: "@@ -3 +3,2 @@\n-const value = 1;\n+const value = 2;\n+run(value);\n" }]);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  disconnect.mockClear();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) {
      revealEnd = () => callback([{ isIntersecting: true } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver);
    }
    observe() {}
    disconnect = disconnect;
  });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it("expands real line diffs, switches layout, and copies the exact patch", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await act(async () => root.render(<DiffView files={files} />));
  expect(container.textContent).toContain("+2−1");
  expect(container.querySelector("code")).toBeNull();
  await act(async () => (container.querySelector("button[aria-expanded]") as HTMLButtonElement).click());
  expect(container.textContent).toContain("const value = 1;");
  expect(container.textContent).toContain("const value = 2;");
  await act(async () => (container.querySelector('[aria-label="差异显示方式"] button:last-child') as HTMLButtonElement).click());
  expect(container.textContent).toContain("修改前修改后");
  expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe("并排");
  await act(async () => (container.querySelector('[aria-label="复制 diff"]') as HTMLButtonElement).click());
  expect(writeText).toHaveBeenCalledWith(files[0].raw);
});

it("loads long diffs in pages and keeps the remainder accessible", async () => {
  const large = changedFiles([{ path: "large.txt", kind: { type: "add" },
    diff: Array.from({ length: 450 }, (_, index) => `line-${index}`).join("\n") }]);
  await act(async () => root.render(<DiffView files={large} />));
  await act(async () => (container.querySelector("button[aria-expanded]") as HTMLButtonElement).click());
  expect(container.querySelectorAll("code")).toHaveLength(200);
  const more = () => [...container.querySelectorAll("button")].find((button) => button.textContent?.startsWith("继续显示"))!;
  await act(async () => more().click());
  expect(container.querySelectorAll("code")).toHaveLength(400);
  await act(async () => more().click());
  expect(container.querySelectorAll("code")).toHaveLength(450);
  expect(container.textContent).toContain("line-449");
});

it("automatically appends one batch per visible end and releases observers after the final page", async () => {
  const large = changedFiles([{ path: "large.txt", kind: { type: "add" },
    diff: Array.from({ length: 450 }, (_, index) => `line-${index}`).join("\n") }]);
  await act(async () => root.render(<DiffView files={large} />));
  await act(async () => (container.querySelector("button[aria-expanded]") as HTMLButtonElement).click());
  expect(container.querySelectorAll("code")).toHaveLength(200);
  await act(async () => { revealEnd(); revealEnd(); });
  expect(container.querySelectorAll("code")).toHaveLength(400);
  expect(disconnect).toHaveBeenCalledTimes(1);
  await act(async () => revealEnd());
  expect(container.querySelectorAll("code")).toHaveLength(450);
  expect(container.textContent).toContain("line-449");
  expect(disconnect).toHaveBeenCalledTimes(2);
  expect(container.textContent).not.toContain("继续显示");
});
