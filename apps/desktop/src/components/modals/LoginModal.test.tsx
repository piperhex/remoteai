// @vitest-environment jsdom
import { act } from "react";
import { ConfigProvider } from "antd";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LoginModal } from "./LoginModal";

const runtime = vi.hoisted(() => ({ hosted: true }));
vi.mock("../../api/backend", () => ({ get isHostedWebApp() { return runtime.hosted; } }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
const onImportText = vi.fn<(content: string) => Promise<boolean>>();
const onClose = vi.fn();
const onImportClipboard = vi.fn();
let container: HTMLDivElement;
let root: Root;

const button = (label: string) => [...document.querySelectorAll("button")]
  .find((item) => item.textContent?.includes(label))!;

beforeEach(() => {
  vi.clearAllMocks();
  runtime.hosted = true;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => getComputedStyle(element));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(<ConfigProvider theme={{ token: { motion: false } }}>
    <LoginModal onClose={onClose} onWebSession={vi.fn()} onStart={vi.fn()} onImport={vi.fn()}
      onImportClipboard={onImportClipboard} onImportText={onImportText} t={(key) => key} />
  </ConfigProvider>));
}

it("offers file and pasted imports without browser authorization or host clipboard access", async () => {
  await render();
  expect(container.textContent).toContain("login.importMultiple");
  expect(container.textContent).not.toContain("login.browser.title");
  expect(container.textContent).not.toContain("login.embedded.title");
  expect(container.textContent).not.toContain("login.webSession.title");
  await act(async () => button("login.importClipboard").click());
  expect(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="login.pasteLabel"]')).not.toBeNull();
  expect((document.querySelector(".ant-modal") as HTMLElement).style.width).toBe("400px");
  expect(button("login.importConfirm").disabled).toBe(true);
  expect(onImportClipboard).not.toHaveBeenCalled();
});

it("retains pasted content after failure and prevents duplicate submissions while importing", async () => {
  await render();
  await act(async () => button("login.importClipboard").click());
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="login.pasteLabel"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "fixture JSON");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  let complete!: (success: boolean) => void;
  onImportText.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  await act(async () => {
    button("login.importConfirm").click();
    button("login.importConfirm").click();
  });
  expect(onImportText).toHaveBeenCalledExactlyOnceWith("fixture JSON");
  await act(async () => complete(false));
  expect(textarea.value).toBe("fixture JSON");
  expect(onClose).not.toHaveBeenCalled();
  onImportText.mockResolvedValue(true);
  await act(async () => button("login.importConfirm").click());
  expect(onClose).toHaveBeenCalledOnce();
});

it("preserves desktop login choices and the native clipboard import", async () => {
  runtime.hosted = false;
  await render();
  expect(container.textContent).toContain("login.browser.title");
  expect(container.textContent).toContain("login.embedded.title");
  expect(container.textContent).toContain("login.webSession.title");
  await act(async () => button("login.importClipboard").click());
  expect(onImportClipboard).toHaveBeenCalledOnce();
  expect(document.querySelector('textarea[aria-label="login.pasteLabel"]')).toBeNull();
});
