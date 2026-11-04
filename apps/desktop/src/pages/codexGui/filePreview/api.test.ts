// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
const fetchMock = vi.fn();
const target = { path: "docs/说明.md", threadId: "thread-one", line: 12 };
const data = { sessionId: "session-one", path: "C:/docs/说明.md", name: "说明.md", kind: "markdown",
  text: "# Hello", url: "/__codex_switch__/file-preview/session-one/%E8%AF%B4%E6%98%8E.md" };

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  document.head.innerHTML = '<meta name="codex-switch-runtime" content="hosted">';
  sessionStorage.setItem("codex-switch:hosted-web-api-key", "lan-key");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { document.head.innerHTML = ""; sessionStorage.clear(); vi.unstubAllGlobals(); });

it("opens and releases previews through authenticated HTTP with a browser-resolvable asset URL", async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: data })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: null })));
  const { filePreviewApi } = await import("../../../../../../shared/file-preview/workspace/api");
  const preview = await filePreviewApi.open(target);
  expect(preview).toEqual({ ...data, url: new URL(data.url, location.origin).href });
  await filePreviewApi.close(data.sessionId);
  expect(fetchMock.mock.calls.map(([url, options]) => [url, options.headers["X-API-Key"], JSON.parse(options.body)]))
    .toEqual([
      ["/__codex_switch__/api/invoke", "lan-key", { command: "codex_gui_open_file_preview", args: { target } }],
      ["/__codex_switch__/api/invoke", "lan-key",
        { command: "codex_gui_close_file_preview", args: { sessionId: data.sessionId } }],
    ]);
  expect(native.invoke).not.toHaveBeenCalled();
});

it("preserves unsupported files and reports missing-file failures", async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: null })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "找不到这个文件" })));
  const { filePreviewApi } = await import("../../../../../../shared/file-preview/workspace/api");
  expect(await filePreviewApi.open(target)).toBeNull();
  await expect(filePreviewApi.open(target)).rejects.toThrow("找不到这个文件");
});

it("keeps native previews on desktop IPC with their existing stream URL", async () => {
  document.head.innerHTML = "";
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  const nativeData = { ...data, url: "http://127.0.0.1:32100/token/preview.md" };
  native.invoke.mockResolvedValueOnce(nativeData);
  const { filePreviewApi } = await import("../../../../../../shared/file-preview/workspace/api");
  expect(await filePreviewApi.open(target)).toEqual(nativeData);
  expect(native.invoke).toHaveBeenCalledWith("codex_gui_open_file_preview", { target });
  expect(fetchMock).not.toHaveBeenCalled();
});
