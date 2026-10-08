// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CliManualDownload } from "./CliManualDownload";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("../../api/backend", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
const links = { platform: "Windows / x64", assetName: "codex-package-x86_64-pc-windows-msvc.tar.gz",
  packageUrl: "https://github.com/openai/codex/releases/latest/download/package.tar.gz",
  metadataUrl: "https://api.github.com/repos/openai/codex/releases/latest",
  releaseUrl: "https://github.com/openai/codex/releases/latest" };
const onImported = vi.fn();
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
const buttons = (label: string) => Array.from(document.querySelectorAll("button"))
  .filter(button => button.textContent?.replace(/\s/g, "") === label);
const click = async (label: string, index = 0) => { await act(async () => buttons(label)[index].click()); };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }));
  const getComputedStyle = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => getComputedStyle(element));
  vi.clearAllMocks();
  mocks.invoke.mockResolvedValue(links);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

async function openDialog() {
  await act(async () => root.render(<CliManualDownload version={null} onImported={onImported} />));
  await click("手动下载");
}

async function chooseFiles() {
  mocks.open.mockResolvedValueOnce("C:\\Downloads\\package.tar.gz")
    .mockResolvedValueOnce("C:\\Downloads\\rust-v0.161.0");
  await click("选择文件"); await click("选择文件");
  for (const [options] of mocks.open.mock.calls) expect(options.filters).toBeUndefined();
}

it("opens usable download links even without a successful version check and handles cancelled selection", async () => {
  await openDialog();
  expect(mocks.invoke).toHaveBeenCalledWith("codex_gui_cli_manual_download", { version: null });
  expect(Array.from(document.querySelectorAll("a")).map(link => link.href)).toEqual([
    links.packageUrl, links.metadataUrl, links.releaseUrl,
  ]);
  expect(buttons("导入并安装")[0].disabled).toBe(true);
  mocks.open.mockResolvedValueOnce(null);
  await click("选择文件");
  expect(buttons("导入并安装")[0].disabled).toBe(true);
  expect(document.body.textContent).not.toContain("导入未完成");
});

it("imports both selected paths, coalesces clicks and reports deferred activation", async () => {
  await openDialog(); await chooseFiles();
  let resolve!: (value: unknown) => void;
  mocks.invoke.mockImplementation(() => new Promise(done => { resolve = done; }));
  await click("导入并安装"); await click("导入并安装");
  expect(mocks.invoke.mock.calls.filter(([command]) => command === "codex_gui_cli_import")).toHaveLength(1);
  expect(mocks.invoke).toHaveBeenLastCalledWith("codex_gui_cli_import", { request: {
    packagePath: "C:\\Downloads\\package.tar.gz", metadataPath: "C:\\Downloads\\rust-v0.161.0",
  } });
  expect(buttons("关闭")[0].disabled).toBe(true);
  const snapshot = { version: "0.160.0", release: { version: "0.161.0", size: 100, ready: true } };
  await act(async () => resolve(snapshot));
  expect(onImported).toHaveBeenCalledWith(snapshot);
  expect(document.body.textContent).toContain("导入成功，更新将在空闲时或下次启动时安装。");
});

it("keeps file selections after a failed import so users can replace a bad file and retry", async () => {
  await openDialog(); await chooseFiles();
  mocks.invoke.mockRejectedValueOnce("安装包与校验文件不匹配，请下载同一版本、适合当前电脑的文件。");
  await click("导入并安装");
  expect(document.body.textContent).toContain("安装包与校验文件不匹配");
  expect(onImported).not.toHaveBeenCalled();
  expect(buttons("重新选择")).toHaveLength(2);
  mocks.invoke.mockResolvedValueOnce({ version: "0.161.0", release: null });
  await click("导入并安装");
  expect(document.body.textContent).toContain("Codex 已安装，可以开始使用了。");
});

it("marks verification optional and imports a package without a verification file", async () => {
  await openDialog();
  const heading = document.querySelector("section:nth-of-type(2) strong")!.parentElement!;
  expect(heading.textContent).toBe("2. 版本校验文件非必填");
  mocks.open.mockResolvedValueOnce("C:\\Downloads\\package");
  await click("选择文件");
  expect(buttons("导入并安装")[0].disabled).toBe(false);
  mocks.invoke.mockResolvedValueOnce({ version: "0.161.0", release: null });
  await click("导入并安装");
  expect(mocks.invoke).toHaveBeenLastCalledWith("codex_gui_cli_import", {
    request: { packagePath: "C:\\Downloads\\package" },
  });
  expect(document.body.textContent).toContain("Codex 已安装，可以开始使用了。");
});

it("allows removing optional verification while keeping the selected package", async () => {
  await openDialog(); await chooseFiles();
  await click("移除");
  expect(document.body.textContent).not.toContain("已选择：rust-v0.161.0");
  expect(buttons("重新选择")).toHaveLength(1);
  expect(buttons("导入并安装")[0].disabled).toBe(false);
  mocks.invoke.mockResolvedValueOnce({ version: "0.161.0", release: null });
  await click("导入并安装");
  expect(mocks.invoke).toHaveBeenLastCalledWith("codex_gui_cli_import", {
    request: { packagePath: "C:\\Downloads\\package.tar.gz" },
  });
});

it.each([
  "安装所在磁盘空间不足，请释放空间后重试。",
  "安装文件被其他程序占用，请关闭相关程序后重试。",
  "安装包无法解压，可能已损坏。请重新下载完整安装包。",
  "安装包缺少 Codex 启动文件，请下载适合当前电脑的完整安装包。",
])("shows the specific installation failure and allows retry: %s", async message => {
  await openDialog(); await chooseFiles();
  mocks.invoke.mockRejectedValueOnce(message);
  await click("导入并安装");
  expect(document.querySelector(".ant-alert-message")?.textContent).toBe(message);
  expect(buttons("导入并安装")[0].disabled).toBe(false);
  expect(buttons("重新选择")).toHaveLength(2);
  expect(onImported).not.toHaveBeenCalled();
});
