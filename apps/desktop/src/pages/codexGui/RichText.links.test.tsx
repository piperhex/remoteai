// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { RichText } from "../../../../../shared/conversation/RichText";
import { PreviewMarkdown } from "../../../../../shared/file-preview/workspace/PreviewMarkdown";
import { DetailsContext } from "../../../../../shared/conversation/detailsContext";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../../../shared/conversation/FileMenu", () => ({ FileMenu: () => <span data-file-link /> }));
const report = "前端 **http://localhost:3002**、后端 **http://127.0.0.1:8082** 均保持运行。"
  + "本轮发现的问题尚未修复。";
const urls = ["http://localhost:3002", "http://127.0.0.1:8082"];
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
const render = (text: string) => act(async () => root.render(<RichText text={text} />));
const destinations = () => Array.from(container.querySelectorAll("a"), link => link.getAttribute("href"));

it.each(["message", "preview"])("renders both reported URLs in bold in a %s", async (view) => {
  await act(async () => root.render(view === "message" ? <RichText text={report} />
    : <PreviewMarkdown text={report} path="C:/report.md" url="http://localhost/preview/report.md" />));
  expect(destinations()).toEqual(urls);
  expect(Array.from(container.querySelectorAll("strong a"), link => link.textContent)).toEqual(urls);
  expect(container.textContent).toBe(report.replaceAll("**", ""));
  expect(container.querySelector("[data-file-link]")).toBeNull();
  for (const link of container.querySelectorAll("a")) await act(async () => link.click());
  expect(vi.mocked(openUrl).mock.calls).toEqual(urls.map(url => [url]));
});

it("opens the clean URL in the website sidebar without invoking file handling", async () => {
  const panel = { open: vi.fn(), update: vi.fn(), setConversationChanges: vi.fn(),
    openFile: vi.fn(), openWebsite: vi.fn(), showingChanges: false, visible: false, close: vi.fn() };
  await act(async () => root.render(
    <DetailsContext.Provider value={panel}><RichText text={report} /></DetailsContext.Provider>,
  ));
  for (const link of container.querySelectorAll("a")) await act(async () => link.click());
  expect(panel.openWebsite.mock.calls).toEqual(urls.map(url => [url]));
  expect(panel.openFile).not.toHaveBeenCalled();
  expect(openUrl).not.toHaveBeenCalled();
});

it.each(["**", "__", "*", "~~"])("preserves %s formatting next to Chinese punctuation", async (marker) => {
  await render(`${marker}https://example.com/a_b?q=1&next=2#part${marker}、后续文字`);
  expect(destinations()).toEqual(["https://example.com/a_b?q=1&next=2#part"]);
  expect(container.textContent).toBe("https://example.com/a_b?q=1&next=2#part、后续文字");
});

it("recognizes bare local and www links without swallowing Chinese sentence boundaries", async () => {
  await render("http://localhost:3002、后端 http://127.0.0.1:8082。www.example.com，继续。"
    + "https://example.com/中文?x=1#片段。结束");
  expect(destinations()).toEqual([...urls, "http://www.example.com",
    "https://example.com/%E4%B8%AD%E6%96%87?x=1#%E7%89%87%E6%AE%B5"]);
});

it("preserves explicit destinations, balanced parentheses and code examples", async () => {
  const explicit = "https://example.com/a**、b";
  await render(`[文档](${explicit}) (https://example.com/a_(b)).\n\n`
    + "`http://localhost:3002**`\n\n```text\n**http://localhost:3002**、后端\n```");
  expect(destinations()).toEqual(["https://example.com/a**%E3%80%81b", "https://example.com/a_(b)"]);
  expect(container.querySelectorAll("code a")).toHaveLength(0);
  expect(container.querySelector("pre")?.textContent).toBe("**http://localhost:3002**、后端\n");
});

it("preserves file links and avoids turning filenames or unsafe protocols into web links", async () => {
  await render("[报告](C:/report.md) README.md example.com [危险](javascript:alert(1))");
  expect(container.querySelectorAll("[data-file-link]")).toHaveLength(1);
  expect(destinations()).toEqual([]);
});
