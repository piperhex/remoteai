// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Menu } from "@tauri-apps/api/menu";
import { ImagePreview } from "./ImagePreview";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/menu", () => ({ Menu: { new: vi.fn() } }));
const original = "data:image/png;base64,b3JpZ2luYWw=";
const popup = vi.fn().mockResolvedValue(undefined);
const release = vi.fn().mockResolvedValue(undefined);
let items: { text: string; action: () => void }[];
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockResolvedValue({ completed: true });
  vi.mocked(Menu.new).mockImplementation(async (options) => {
    items = options?.items as typeof items;
    return { popup, close: release } as unknown as Menu;
  });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(load = async () => original) {
  await act(async () => root.render(<ImagePreview thumbnail="thumbnail" description="截图"
    load={load} close={() => {}} />));
  await act(async () => container.querySelector<HTMLButtonElement>('.cs-image-original')?.click());
}

async function openMenu() {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 90 });
  await act(async () => { container.querySelector(".cs-image-stage")?.dispatchEvent(event); });
  return event;
}

it("opens a native menu at the pointer and copies original image bytes", async () => {
  await render();
  expect((await openMenu()).defaultPrevented).toBe(true);
  expect(items.map((item) => item.text)).toEqual(["复制图片", "另存为…"]);
  expect(popup).toHaveBeenCalledWith(expect.objectContaining({ x: 120, y: 90 }));
  await act(async () => items[0].action());
  expect(invoke).toHaveBeenCalledWith("codex_gui_image_action", {
    request: { source: original, action: "copy" },
  });
  expect(container.textContent).toContain("图片已复制");
  await openMenu();
  expect(Menu.new).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null));
  expect(release).toHaveBeenCalledOnce();
});

it("saves the original, handles cancellation quietly, and reports failures without internal details", async () => {
  await render();
  await openMenu();
  await act(async () => items[1].action());
  expect(invoke).toHaveBeenLastCalledWith("codex_gui_image_action", {
    request: { source: original, action: "saveAs" },
  });
  expect(container.textContent).toContain("图片已保存");
  vi.mocked(invoke).mockResolvedValueOnce({ completed: false });
  await act(async () => items[1].action());
  expect(container.textContent).not.toContain("图片已保存");
  vi.mocked(invoke).mockRejectedValueOnce(new Error("private path"));
  await act(async () => items[0].action());
  expect(container.textContent).toContain("图片未能复制，请重试。");
  expect(container.textContent).not.toContain("private path");
});

it("does not start overlapping actions while copying or saving", async () => {
  let finish: (value: { completed: boolean }) => void = () => {};
  vi.mocked(invoke).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await render();
  await openMenu();
  await act(async () => { items[0].action(); items[1].action(); });
  await openMenu();
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(popup).toHaveBeenCalledTimes(1);
  await act(async () => finish({ completed: true }));
});

it("keeps actions unavailable while the original is loading or has failed", async () => {
  let fail: (reason: Error) => void = () => {};
  await render(() => new Promise((_, reject) => { fail = reject; }));
  await openMenu();
  expect(Menu.new).not.toHaveBeenCalled();
  await act(async () => fail(new Error("missing")));
  await openMenu();
  expect(Menu.new).not.toHaveBeenCalled();
});

it("does not capture right-button drags and preserves browser context menus", async () => {
  await render();
  const stage = container.querySelector(".cs-image-stage") as HTMLDivElement;
  const capture = vi.fn();
  stage.setPointerCapture = capture;
  await act(async () => { stage.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 2 })); });
  expect(capture).not.toHaveBeenCalled();
  vi.mocked(isTauri).mockReturnValue(false);
  await render();
  expect((await openMenu()).defaultPrevented).toBe(false);
  expect(Menu.new).not.toHaveBeenCalled();
});
