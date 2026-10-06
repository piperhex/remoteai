// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { Menu } from "@tauri-apps/api/menu";
import { ImageAttachments } from "./ImageAttachments";
import type { DraftImage } from "./useComposerDraft";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock("@tauri-apps/api/menu", () => ({ Menu: { new: vi.fn() } }));

const images: DraftImage[] = [
  { id: "one", name: "第一张.png", url: "data:image/png;base64,b25l" },
  { id: "two", name: "第二张.png", url: "data:image/png;base64,dHdv" },
];
const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
let root: Root;
let host: HTMLDivElement;
const removed = vi.fn();
const submitted = vi.fn();

function Fixture({ active = true, disabled = false, draftKey = "one" }: {
  active?: boolean; disabled?: boolean; draftKey?: string;
}) {
  const [attachments, setAttachments] = useState(images);
  return <form onSubmit={(event) => {
    event.preventDefault(); submitted();
  }}>
    <textarea defaultValue="尚未发送的内容" />
    <ImageAttachments key={draftKey} images={attachments} active={active} disabled={disabled} onRemove={(id) => {
      removed(id); setAttachments((values) => values.filter((image) => image.id !== id));
    }} />
  </form>;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true, value(this: HTMLDialogElement) { this.open = true; },
  });
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (showModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", showModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});
const render = (props: Parameters<typeof Fixture>[0] = {}) => act(async () => root.render(<Fixture {...props} />));
const click = (label: string) => act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
const dialog = () => document.querySelector("dialog");

it("opens the selected full-size image and closes with Escape without changing or sending the draft", async () => {
  await render();
  await click("放大查看：图片 2");
  expect(dialog()?.querySelector("img")?.getAttribute("src")).toBe(images[1].url);
  await act(async () => { dialog()!.dispatchEvent(new Event("cancel", { cancelable: true })); });
  expect(dialog()).toBeNull();
  expect(host.querySelector("textarea")?.value).toBe("尚未发送的内容");
  expect(host.querySelectorAll("img")).toHaveLength(2);
  expect(removed).not.toHaveBeenCalled(); expect(submitted).not.toHaveBeenCalled();
});

it("keeps removal separate from preview and still allows preview while sending", async () => {
  await render({ disabled: true });
  await click("移除图片 1");
  expect(removed).not.toHaveBeenCalled();
  await click("放大查看：图片 1");
  expect(dialog()).not.toBeNull();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭图片"]')!.click());
  await render();
  await click("移除图片 1");
  expect(removed).toHaveBeenCalledWith("one");
  expect(host.querySelectorAll("img")).toHaveLength(1);
  expect(dialog()).toBeNull(); expect(submitted).not.toHaveBeenCalled();
});

it("closes previews when leaving the page or switching drafts", async () => {
  await render(); await click("放大查看：图片 1");
  await render({ active: false });
  expect(dialog()).toBeNull();
  await render(); expect(dialog()).toBeNull();
  await click("放大查看：图片 1");
  await render({ draftKey: "other" });
  expect(dialog()).toBeNull();
});

it("copies and saves the selected attachment from its preview context menu", async () => {
  let items: { action: (id: string) => void }[] = [];
  const release = vi.fn().mockResolvedValue(undefined);
  vi.mocked(invoke).mockResolvedValue({ completed: true });
  vi.mocked(Menu.new).mockImplementation(async (options) => {
    items = options?.items as typeof items;
    return { popup: vi.fn().mockResolvedValue(undefined), close: release } as unknown as Menu;
  });
  await render();
  await click("放大查看：图片 2");
  await act(async () => dialog()?.querySelector<HTMLButtonElement>('.cs-image-original')?.click());
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  await act(async () => { dialog()?.querySelector("img")?.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  for (const [index, action] of ["copy", "saveAs"].entries()) {
    await act(async () => items[index].action(action));
    expect(invoke).toHaveBeenLastCalledWith("codex_gui_image_action", {
      request: { source: images[1].url, action },
    });
  }
  await render({ active: false });
  expect(release).toHaveBeenCalledOnce();
  expect(submitted).not.toHaveBeenCalled();
});

it("uses the full-screen chat viewer with zoom, rotation, dragging and reset without submitting", async () => {
  await render(); await click("放大查看：图片 1");
  expect(dialog()?.open).toBe(true);
  expect(dialog()?.classList.contains("cs-image-viewer")).toBe(true);
  const image = dialog()!.querySelector("img")!;
  await click("放大图片");
  expect(image.style.transform).toContain("scale(1.5)");
  await click("缩小图片");
  expect(image.style.transform).toContain("scale(1)");
  await click("旋转图片");
  expect(image.style.transform).toContain("rotate(90deg)");
  const stage = dialog()!.querySelector<HTMLDivElement>(".cs-image-stage")!;
  stage.setPointerCapture = vi.fn();
  await act(async () => { stage.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -100 })); });
  expect(image.style.transform).toContain("scale(1.2)");
  await act(async () => {
    stage.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 20, clientY: 30 }));
  });
  await act(async () => {
    stage.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 70, clientY: 90 }));
  });
  expect(image.style.transform).toContain("translate(50px, 60px)");
  await click("还原图片");
  expect(image.style.transform).toBe("translate(0px, 0px) rotate(0deg) scale(1)");
  await click("关闭图片");
  expect(dialog()).toBeNull();
  expect(host.querySelector("textarea")?.value).toBe("尚未发送的内容");
  expect(host.querySelectorAll("img")).toHaveLength(2);
  expect(removed).not.toHaveBeenCalled(); expect(submitted).not.toHaveBeenCalled();
});
