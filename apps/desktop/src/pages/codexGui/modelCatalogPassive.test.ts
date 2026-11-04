// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "../../../../../shared/conversation/api";
import { GuiController } from "./controller";
import { GuiModelCatalog } from "./modelCatalog";
import { ComposerBridge } from "./composerBridge";
import type { Model } from "../../../../../shared/conversation/types";

vi.mock("../../../../../shared/conversation/api", () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
const model: Model = { id: "saved", model: "saved", displayName: "Saved", isDefault: true,
  defaultReasoningEffort: "high", supportedReasoningEfforts: [{ reasoningEffort: "high", description: "" }] };
const page = { data: [model], nextCursor: null };
const DAY_MS = 24 * 60 * 60 * 1000;
const cleanup: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); localStorage.clear();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockResolvedValue(() => {});
  vi.mocked(guiApi.request).mockImplementation(async request =>
    request.operation === "models" ? page : { data: [], nextCursor: null });
});
afterEach(() => { cleanup.splice(0).forEach(stop => stop()); vi.clearAllTimers(); vi.useRealTimers(); });
const requests = () => vi.mocked(guiApi.request).mock.calls.filter(([request]) => request.operation === "models");
function catalog() {
  const accept = vi.fn();
  const value = new GuiModelCatalog({ ready: () => true, accept });
  cleanup.push(() => value.suspend());
  return { value, accept };
}

it("restores cached models on connect/reconnect and never fetches during a running turn", async () => {
  const controller = new GuiController();
  const bridge = new ComposerBridge();
  cleanup.push(() => controller.dispose(), bridge.attach(controller));
  await controller.connect();
  await controller.connect();
  expect(requests().length).toBeGreaterThan(0);
  expect(requests().every(([request]) => request.operation === "models" && request.cacheOnly)).toBe(true);
  const count = requests().length;
  const receive = vi.mocked(guiApi.subscribe).mock.calls[0][0];
  receive({ method: "turn/started", params: { threadId: "running",
    turn: { id: "turn", status: "inProgress", items: [] } } });
  await bridge.read();
  await vi.advanceTimersByTimeAsync(DAY_MS);
  expect(requests()).toHaveLength(count);
  expect(controller.getSnapshot().models).toEqual([model]);
});

it.each(["empty", "failure"])("never discovers models after a %s cache read or remote recovery", async mode => {
  const { value } = catalog();
  if (mode === "empty") vi.mocked(guiApi.request).mockResolvedValue({ data: [], nextCursor: null });
  else vi.mocked(guiApi.request).mockRejectedValue(new Error("cache unavailable"));
  await value.restore().catch(() => {});
  await value.recover().catch(() => {});
  await vi.advanceTimersByTimeAsync(DAY_MS);
  expect(requests()).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
  vi.mocked(guiApi.request).mockResolvedValue(page);
  await value.refresh();
  expect(requests()[1][0]).toEqual({ operation: "models", cursor: undefined });
  await expect(value.ready()).resolves.toBeUndefined();
});

it("restores saved Provider models without CLI capability discovery", async () => {
  const { value, accept } = catalog();
  value.setProviderSource(async () => [model]);
  await value.restore();
  await vi.advanceTimersByTimeAsync(DAY_MS);
  expect(guiApi.request).not.toHaveBeenCalled();
  expect(accept).toHaveBeenCalledExactlyOnceWith([model]);
});

it.each(["retry", "source change"])("honors %s while a cached read is pending and rejects its stale result", async action => {
  const { value, accept } = catalog();
  let finish!: (value: typeof page) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue(page);
  const restoring = value.restore();
  const refreshing = action === "retry" ? value.refresh() : value.invalidate();
  finish({ data: [{ ...model, model: "stale" }], nextCursor: null });
  await Promise.all([restoring, refreshing]);
  expect(requests()).toHaveLength(2);
  expect(requests()[1][0]).toEqual({ operation: "models", cursor: undefined });
  expect(accept).toHaveBeenCalledExactlyOnceWith([model]);
});

it("cancels an earlier automatic failure retry when reconnecting with cached data", async () => {
  const { value } = catalog();
  vi.mocked(guiApi.request).mockRejectedValueOnce(new Error("offline"));
  await value.invalidate().catch(() => {});
  await value.restore();
  await vi.advanceTimersByTimeAsync(DAY_MS);
  expect(requests()).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("clears stale models after a reconnect cache failure and waits for an explicit retry", async () => {
  const controller = new GuiController();
  cleanup.push(() => controller.dispose());
  await controller.connect();
  expect(controller.getSnapshot().models).toEqual([model]);
  vi.mocked(guiApi.request).mockImplementation(async request => {
    if (request.operation === "models") throw new Error("cache unavailable");
    return { data: [], nextCursor: null };
  });
  await controller.connect();
  expect(controller.getSnapshot()).toMatchObject({ models: [], modelCatalogLoading: false });
  expect(controller.getSnapshot().modelCatalogError).toBeTruthy();
  await expect(controller.modelCatalog.ready()).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(DAY_MS);
  expect(requests()).toHaveLength(2);
  expect(requests().every(([request]) => request.operation === "models" && request.cacheOnly)).toBe(true);
  vi.mocked(guiApi.request).mockResolvedValue(page);
  await controller.refreshModels();
  expect(controller.getSnapshot()).toMatchObject({ models: [model], modelCatalogError: "" });
  expect(requests()[2][0]).toEqual({ operation: "models", cursor: undefined });
  await expect(controller.modelCatalog.ready()).resolves.toBeUndefined();
});
