// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "../../api/backend";
import { ComposerFileImage } from "./ComposerFileImage";

vi.mock("../../api/backend", () => ({ invoke: vi.fn() }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
const thumbnail = "data:image/jpeg;base64,dGh1bWJuYWls";
const original = "data:image/jpeg;base64,b3JpZ2luYWw=";
const item = { kind: "file" as const, path: "F:/Downloads/large.jpg", name: "large.jpg" };
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = () => act(async () => root.render(
  <ComposerFileImage item={item} disabled={false} active onRemove={vi.fn()} />,
));

it("loads a small thumbnail first and reads the original when the preview opens", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ url: thumbnail }).mockResolvedValueOnce({ url: original });
  await render();
  expect(host.querySelector("img")?.src).toBe(thumbnail);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("codex_gui_attachment_preview", {
    request: { path: item.path, variant: "thumbnail" },
  });
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="放大查看：large.jpg"]')!.click());
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(host.querySelector('.cs-image-original')).toBeNull();
  expect(invoke).toHaveBeenLastCalledWith("codex_gui_attachment_preview", {
    request: { path: item.path, variant: "original" },
  });
  expect(host.querySelector<HTMLImageElement>("dialog img")?.src).toBe(original);
});

it("explains resource failures and retries without exposing internal errors", async () => {
  const resourceError = "图片过大，暂时无法预览。请缩小尺寸后重试。";
  vi.mocked(invoke).mockRejectedValueOnce(resourceError).mockResolvedValueOnce({ url: thumbnail });
  await render();
  expect(host.querySelector('[role="status"]')?.textContent).toContain(resourceError);
  await act(async () => host.querySelector<HTMLButtonElement>('[role="status"] button')!.click());
  expect(host.querySelector("img")?.src).toBe(thumbnail);
  expect(host.querySelector('[role="status"]')).toBeNull();
});

it("shows a safe message for unreadable or invalid files", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("private path: C:/secret"));
  await render();
  expect(host.textContent).toContain("图片无法读取，请重新选择。");
  expect(host.textContent).not.toContain("C:/secret");
});
