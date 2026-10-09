// @vitest-environment jsdom
import { act, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { message } from "antd";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetailsWorkspace } from "./DetailsWorkspace";
import { DetailsContext } from "./detailsContext";
import { filePreviewApi, type FilePreviewData } from "./filePreview/api";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
let root: Root;
let host: HTMLDivElement;
let session = 0;
const button = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
const click = (label: string) => act(async () => button(label).click());
const heading = () => host.querySelector('section header strong')?.textContent;
const file = (name: string): FilePreviewData => ({ sessionId: String(++session), name, path: `/${name}`,
  kind: "markdown", text: `# ${name}`, url: `http://localhost/${name}` });

function Links() {
  const panel = useContext(DetailsContext)!;
  return <>
    {["first.md", "second.md", "third.md"].map(name => <button key={name} aria-label={name}
      onClick={() => { void panel.openFile({ path: name, threadId: "thread", line: 3, column: 2 }); }}>{name}</button>)}
    <button aria-label="website" onClick={() => panel.openWebsite("https://example.com")}>Website</button>
  </>;
}
function Fixture({ selected = "thread", enabled = true }: { selected?: string; enabled?: boolean }) {
  return <DetailsWorkspace selected={selected} active enabled={enabled}><Links /></DetailsWorkspace>;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1200, 800));
  vi.spyOn(filePreviewApi, "open").mockImplementation(async target => ({ ...file(target.path), ...target }));
  vi.spyOn(filePreviewApi, "close").mockResolvedValue();
  vi.spyOn(message, "error").mockImplementation(vi.fn());
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("reopens files with their original thread and location when moving back and forward", async () => {
  await click("first.md");
  expect(button("返回上一页").disabled).toBe(true);
  expect(button("前往下一页").disabled).toBe(true);
  await click("second.md");
  await click("返回上一页");
  expect(heading()).toBe("first.md");
  expect(filePreviewApi.open).toHaveBeenLastCalledWith({ path: "first.md", threadId: "thread", line: 3, column: 2 });
  expect(button("返回上一页").disabled).toBe(true);
  expect(button("前往下一页").disabled).toBe(false);
  await click("前往下一页");
  expect(heading()).toBe("second.md");
  expect(button("前往下一页").disabled).toBe(true);
  expect(filePreviewApi.close).toHaveBeenCalledTimes(3);
});

it("shares history between files and websites and replaces the forward branch after a new visit", async () => {
  await click("first.md"); await click("website");
  expect(heading()).toBe("网页预览");
  await click("返回上一页"); expect(heading()).toBe("first.md");
  await click("前往下一页"); expect(heading()).toBe("网页预览");
  await click("返回上一页"); await click("third.md");
  expect(button("前往下一页").disabled).toBe(true);
  await click("返回上一页"); expect(heading()).toBe("first.md");
  await click("前往下一页"); expect(heading()).toBe("third.md");
});

it("does not duplicate the current target and keeps history across tab switches and minimize", async () => {
  await click("first.md"); await click("first.md");
  expect(button("返回上一页").disabled).toBe(true);
  await click("second.md");
  const tab = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find(element => element.textContent === name)!;
  await act(async () => tab("文件更改").click());
  await act(async () => tab("预览").click());
  await click("最小化详情抽屉");
  await act(async () => [...host.querySelectorAll("button")].find(element => element.textContent === "恢复预览")!.click());
  await click("返回上一页"); expect(heading()).toBe("first.md");
  await click("first.md"); expect(button("前往下一页").disabled).toBe(false);
});

it.each(["unavailable", "failed"])("keeps the current preview and history after an %s revisit", async result => {
  await click("first.md"); await click("second.md");
  if (result === "unavailable") vi.mocked(filePreviewApi.open).mockResolvedValueOnce(null);
  else vi.mocked(filePreviewApi.open).mockRejectedValueOnce(new Error("private internal details"));
  await click("返回上一页");
  expect(heading()).toBe("second.md");
  expect(button("返回上一页").disabled).toBe(false);
  expect(button("前往下一页").disabled).toBe(true);
  expect(message.error).toHaveBeenCalledWith({ content: "预览未能打开，请稍后重试。",
    style: { maxWidth: 400, marginInline: "auto" } });
  await click("返回上一页"); expect(heading()).toBe("first.md");
});

it("prevents overlapping history reads and discards a revisit superseded by a new website", async () => {
  await click("first.md"); await click("second.md");
  let resolve!: (value: FilePreviewData) => void;
  vi.mocked(filePreviewApi.open).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await click("返回上一页");
  expect(button("返回上一页").disabled).toBe(true);
  expect(button("前往下一页").disabled).toBe(true);
  await click("返回上一页"); expect(filePreviewApi.open).toHaveBeenCalledTimes(3);
  await click("website");
  await act(async () => resolve({ ...file("first.md"), sessionId: "stale" }));
  expect(heading()).toBe("网页预览");
  expect(filePreviewApi.close).toHaveBeenCalledWith("stale");
  await click("返回上一页"); expect(heading()).toBe("second.md");
});

it.each(["close", "conversation", "disable"])("clears history on %s and cancels pending revisits", async action => {
  await click("first.md"); await click("second.md");
  let resolve!: (value: FilePreviewData) => void;
  vi.mocked(filePreviewApi.open).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await click("返回上一页");
  if (action === "close") await click("关闭详情抽屉");
  else await act(async () => root.render(<Fixture selected="other" enabled={action !== "disable"} />));
  await act(async () => resolve({ ...file("first.md"), sessionId: "cancelled" }));
  expect(host.querySelector("aside")).toBeNull();
  expect(filePreviewApi.close).toHaveBeenCalledWith("cancelled");
  await act(async () => root.render(<Fixture selected="other" />));
  await click("third.md");
  expect(button("返回上一页").disabled).toBe(true);
  expect(button("前往下一页").disabled).toBe(true);
});
