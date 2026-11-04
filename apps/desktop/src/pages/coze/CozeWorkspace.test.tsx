// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  COZE_DESKTOP_READY, COZE_DESKTOP_STATE, COZE_DESKTOP_STOP, COZE_DESKTOP_STOP_READY, withCozeLanguage,
} from "../../../../../shared/coze/desktopBridge";
import { setGuiLanguage } from "../../../../../shared/localization/uiText";
import { CozeWorkspace } from "./CozeWorkspace";

const url = "http://127.0.0.1:4321/";
const origin = new URL(url).origin;
const stop = vi.fn(async () => {});
let host: HTMLDivElement;
let root: Root;
let frame: HTMLIFrameElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setGuiLanguage("zh");
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<CozeWorkspace url={url} busy={false} error="" onStop={stop} />));
  frame = host.querySelector("iframe")!;
});

afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  setGuiLanguage("zh");
  vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals();
});

it('keeps a working desktop stop control for old runtimes and failed initialization', async () => {
  expect(host.textContent).toContain('停止 Coze');
  await act(async () => { frame.dispatchEvent(new Event('load')); });
  expect(host.textContent).toContain('停止 Coze');
  await act(async () => { frame.dispatchEvent(new Event('error')); });
  await act(async () => { host.querySelector('button')!.click(); });
  const confirm = document.querySelector<HTMLButtonElement>('.ant-popconfirm-buttons .ant-btn-primary')!;
  await act(async () => { confirm.click(); });
  expect(stop).toHaveBeenCalledOnce();
});

it('hides the fallback only after the current frame confirms its stop control and restores it on reload', async () => {
  await act(async () => { window.dispatchEvent(new MessageEvent('message', {
    source: frame.contentWindow, origin, data: COZE_DESKTOP_READY,
  })); });
  expect(host.textContent).toContain('停止 Coze');
  await act(async () => { window.dispatchEvent(new MessageEvent('message', {
    source: frame.contentWindow, origin, data: COZE_DESKTOP_STOP_READY,
  })); });
  expect(host.textContent).not.toContain('停止 Coze');
  await act(async () => { frame.dispatchEvent(new Event('load')); });
  expect(host.textContent).toContain('停止 Coze');
});

it("only stops for messages from the current Coze frame and origin", async () => {
  for (const message of [
    { source: window, origin, data: COZE_DESKTOP_STOP },
    { source: frame.contentWindow, origin: "https://unrelated.example", data: COZE_DESKTOP_STOP },
    { source: frame.contentWindow, origin, data: { type: COZE_DESKTOP_STOP } },
  ]) await act(async () => { window.dispatchEvent(new MessageEvent<unknown>("message", message)); });
  expect(stop).not.toHaveBeenCalled();
  await act(async () => { window.dispatchEvent(new MessageEvent("message", {
    source: frame.contentWindow, origin, data: COZE_DESKTOP_STOP,
  })); });
  expect(stop).toHaveBeenCalledOnce();
});

it("announces availability, blocks requests while busy, and allows retry after a failure", async () => {
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  await act(async () => { window.dispatchEvent(new MessageEvent("message", {
    source: frame.contentWindow, origin, data: COZE_DESKTOP_READY,
  })); });
  expect(post).toHaveBeenLastCalledWith({ type: COZE_DESKTOP_STATE, busy: false, language: "zh" }, origin);
  await act(async () => root.render(<CozeWorkspace url={url} busy error="" onStop={stop} />));
  expect(post).toHaveBeenLastCalledWith({ type: COZE_DESKTOP_STATE, busy: true, language: "zh" }, origin);
  await act(async () => { window.dispatchEvent(new MessageEvent("message", {
    source: frame.contentWindow, origin, data: COZE_DESKTOP_STOP,
  })); });
  expect(stop).not.toHaveBeenCalled();
  await act(async () => root.render(<CozeWorkspace url={url} busy={false} error="请重试" onStop={stop} />));
  expect(post).toHaveBeenLastCalledWith({ type: COZE_DESKTOP_STATE, busy: false, language: "zh" }, origin);
  expect(host.textContent).toContain("请重试");
  await act(async () => { window.dispatchEvent(new MessageEvent("message", {
    source: frame.contentWindow, origin, data: COZE_DESKTOP_STOP,
  })); });
  expect(stop).toHaveBeenCalledOnce();
});

it("adds the interface language to the editor fragment without disturbing the token", () => {
  expect(withCozeLanguage("http://127.0.0.1:4321/#token=abc123", "ru"))
    .toBe("http://127.0.0.1:4321/#token=abc123&lang=ru");
  expect(withCozeLanguage("http://127.0.0.1:4321/#token=abc123&lang=zh", "en"))
    .toBe("http://127.0.0.1:4321/#token=abc123&lang=en");
  expect(withCozeLanguage(url, "zh")).toBe(`${url}#lang=zh`);
});

it("opens the editor in the current interface language", async () => {
  const tokenUrl = `${url}#token=abc123`;
  await act(async () => root.render(<CozeWorkspace url={tokenUrl} busy={false} error="" onStop={stop} />));
  expect(host.querySelector("iframe")!.getAttribute("src")).toBe(`${tokenUrl}&lang=zh`);
  await act(async () => root.unmount());
  setGuiLanguage("ru");
  root = createRoot(host);
  await act(async () => root.render(<CozeWorkspace url={tokenUrl} busy={false} error="" onStop={stop} />));
  expect(host.querySelector("iframe")!.getAttribute("src")).toBe(`${tokenUrl}&lang=ru`);
});

it("sends language switches to the open editor without reloading it", async () => {
  const src = frame.getAttribute("src");
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  for (const language of ["ru", "ja", "en", "zh"] as const) {
    await act(async () => setGuiLanguage(language));
    expect(post).toHaveBeenLastCalledWith({ type: COZE_DESKTOP_STATE, busy: false, language }, origin);
    expect(host.querySelector("iframe")).toBe(frame);
    expect(frame.getAttribute("src")).toBe(src);
  }
  await act(async () => { window.dispatchEvent(new MessageEvent("message", {
    source: frame.contentWindow, origin, data: COZE_DESKTOP_READY,
  })); });
  expect(post).toHaveBeenLastCalledWith({ type: COZE_DESKTOP_STATE, busy: false, language: "zh" }, origin);
});

it("shows desktop runtime errors in the interface language", async () => {
  await act(async () => root.render(
    <CozeWorkspace url={url} busy={false} error="Coze 未能启动，请重试。" onStop={stop} />));
  expect(host.textContent).toContain("Coze 未能启动，请重试。");
  await act(async () => setGuiLanguage("ru"));
  expect(host.textContent).toContain("Не удалось запустить Coze. Повторите попытку.");
  await act(async () => setGuiLanguage("en"));
  expect(host.textContent).toContain("Could not start Coze. Please try again.");
});
