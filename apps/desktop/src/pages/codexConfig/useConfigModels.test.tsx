// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readCodexConfigModelNames } from "../../api/codexConfig";
import { useConfigModels } from "./useConfigModels";

vi.mock("../../api/backend", () => ({ hasLocalBackend: true }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
vi.mock("../../api/codexConfig", () => ({ readCodexConfigModelNames: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
let state: ReturnType<typeof useConfigModels>;
function Harness({ active }: { active: boolean }) {
  state = useConfigModels(active);
  return null;
}
const render = (active = true) => act(async () => root.render(
  <StrictMode><Harness active={active} /></StrictMode>,
));
function deferred() {
  let resolve!: (models: string[]) => void;
  const promise = new Promise<string[]>((complete) => { resolve = complete; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(readCodexConfigModelNames).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("loads on activation and shares a pending request across repeated reloads", async () => {
  const request = deferred();
  vi.mocked(readCodexConfigModelNames).mockReturnValue(request.promise);
  await render(false);
  expect(readCodexConfigModelNames).not.toHaveBeenCalled();
  await render();
  expect(state.loading).toBe(true);
  expect(state.models).toEqual([]);
  await act(async () => { void state.reload(); void state.reload(); });
  expect(readCodexConfigModelNames).toHaveBeenCalledTimes(1);
  await act(async () => request.resolve(["gpt-6.1-sol", "admin-new-model"]));
  expect(state.models).toEqual(["gpt-6.1-sol", "admin-new-model"]);
  expect(state.loading).toBe(false);
});

it("refreshes the list when returning to the page without polling while inactive", async () => {
  vi.mocked(readCodexConfigModelNames).mockResolvedValueOnce(["old-model"])
    .mockResolvedValueOnce(["new-model"]);
  await render();
  await render();
  await render(false);
  expect(readCodexConfigModelNames).toHaveBeenCalledTimes(1);
  expect(state.models).toEqual(["old-model"]);
  await render();
  expect(readCodexConfigModelNames).toHaveBeenCalledTimes(2);
  expect(state.models).toEqual(["new-model"]);
});

it("retains successful suggestions after a failed refresh and replaces them on retry", async () => {
  vi.mocked(readCodexConfigModelNames).mockResolvedValueOnce(["cached-model"])
    .mockRejectedValueOnce(new Error("private server address"))
    .mockResolvedValueOnce(["replacement-model"]);
  await render();
  await act(async () => state.reload());
  expect(state.models).toEqual(["cached-model"]);
  expect(state.error).toBe("模型列表暂时无法更新，请稍后重试。");
  expect(state.loading).toBe(false);
  await act(async () => state.reload());
  expect(state.models).toEqual(["replacement-model"]);
  expect(state.error).toBe("");
});

it("does not invent local suggestions when the initial request fails", async () => {
  vi.mocked(readCodexConfigModelNames).mockRejectedValue(new Error("unavailable"));
  await render();
  expect(state.models).toEqual([]);
  expect(state.error).not.toBe("");
  expect(state.loading).toBe(false);
});

it("ignores a late response from an unmounted page", async () => {
  const previous = deferred();
  vi.mocked(readCodexConfigModelNames).mockReturnValueOnce(previous.promise)
    .mockResolvedValueOnce(["current-model"]);
  await render();
  await act(async () => root.render(null));
  await render();
  await act(async () => previous.resolve(["stale-model"]));
  expect(state.models).toEqual(["current-model"]);
});
