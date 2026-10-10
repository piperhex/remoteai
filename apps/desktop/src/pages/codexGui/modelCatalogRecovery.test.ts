// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "./api";
import { GuiController } from "./controller";
import { GuiModelCatalog } from "./modelCatalog";
import { MODEL_CATALOG_TIMEOUT_MS } from "./modelCatalogTimeout";
import type { Model } from "./types";

vi.mock("./api", () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
const model = (name: string): Model => ({ id: name, model: name, displayName: name, isDefault: true,
  defaultReasoningEffort: "high", supportedReasoningEfforts: [{ reasoningEffort: "high", description: "" }] });
const previous = model("previous");
const current = model("current");
const page = (models: Model[]) => ({ data: models, nextCursor: null });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
};

beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); localStorage.clear();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockResolvedValue(() => {});
});
afterEach(() => vi.useRealTimers());

it("reports an empty initial catalog as a failed load and recovers on retry", async () => {
  vi.mocked(guiApi.request).mockResolvedValue(page([]));
  const controller = new GuiController();
  await controller.connect();
  expect(controller.getSnapshot()).toMatchObject({ models: [], modelCatalogLoading: true,
    modelCatalogError: expect.stringContaining("模型列表") });
  expect(await controller.send("wait", [])).toBe(false);
  vi.mocked(guiApi.request).mockResolvedValue(page([current]));
  await controller.refreshModels();
  expect(controller.getSnapshot()).toMatchObject({ models: [current], modelCatalogLoading: false,
    modelCatalogError: "", error: "" });
  controller.dispose();
});

it("ends a stalled initial load, keeps sending blocked, and retries without reconnecting", async () => {
  const stalled = deferred<unknown>();
  vi.mocked(guiApi.request).mockImplementation(request => request.operation === "models"
    ? stalled.promise : Promise.resolve(page([])));
  const controller = new GuiController();
  const connecting = controller.connect();
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_TIMEOUT_MS);
  await connecting;
  expect(controller.getSnapshot()).toMatchObject({ connection: "ready", modelCatalogLoading: true,
    modelCatalogError: expect.stringContaining("模型列表"), models: [] });
  expect(await controller.send("wait", [])).toBe(false);
  vi.mocked(guiApi.request).mockResolvedValue(page([current]));
  await controller.refreshModels();
  expect(controller.getSnapshot()).toMatchObject({ modelCatalogLoading: false, modelCatalogError: "",
    models: [current], settings: { model: current.model }, error: "" });
  stalled.resolve({ data: [previous], nextCursor: "obsolete-page" });
  await vi.advanceTimersByTimeAsync(0);
  expect(controller.getSnapshot().models).toEqual([current]);
  expect(guiApi.request).not.toHaveBeenCalledWith(expect.objectContaining({ cursor: "obsolete-page" }));
  expect(guiApi.connect).toHaveBeenCalledOnce();
  controller.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it("exposes initial connection failures and reconnects when retrying models", async () => {
  vi.mocked(guiApi.connect).mockRejectedValueOnce(new Error("offline"));
  vi.mocked(guiApi.request).mockImplementation(async request => page(request.operation === "models" ? [current] : []));
  const controller = new GuiController();
  await controller.connect();
  expect(controller.getSnapshot()).toMatchObject({ connection: "offline", modelCatalogLoading: true,
    modelCatalogError: expect.stringContaining("模型列表") });
  await controller.refreshModels();
  expect(controller.getSnapshot()).toMatchObject({ connection: "ready", modelCatalogError: "",
    modelCatalogLoading: false, error: "", models: [current] });
  expect(guiApi.connect).toHaveBeenCalledTimes(2);
  controller.dispose();
});

it("times out Provider reads and ignores their late results before requesting CLI models", async () => {
  const stalled = deferred<Model[] | null>();
  const accept = vi.fn();
  const catalog = new GuiModelCatalog({ ready: () => true, accept });
  catalog.setProviderSource(() => stalled.promise);
  const failure = expect(catalog.invalidate()).rejects.toThrow("模型加载超时");
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_TIMEOUT_MS);
  await failure;
  catalog.setProviderSource(async () => [current]);
  vi.mocked(guiApi.request).mockResolvedValue(page([current]));
  await catalog.refresh();
  stalled.resolve([previous]);
  await vi.advanceTimersByTimeAsync(0);
  expect(guiApi.request).toHaveBeenCalledOnce();
  expect(accept).toHaveBeenCalledExactlyOnceWith([current]);
});

it("bounds the entire paginated read instead of restarting the deadline for each page", async () => {
  const first = deferred<unknown>();
  const second = deferred<unknown>();
  const accept = vi.fn();
  const catalog = new GuiModelCatalog({ ready: () => true, accept });
  vi.mocked(guiApi.request).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const failure = expect(catalog.invalidate()).rejects.toThrow("模型加载超时");
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_TIMEOUT_MS / 2);
  first.resolve({ data: [current], nextCursor: "second" });
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_TIMEOUT_MS / 2);
  await failure;
  second.resolve({ data: [previous], nextCursor: "third" });
  await vi.advanceTimersByTimeAsync(0);
  expect(accept).not.toHaveBeenCalled();
  expect(guiApi.request).toHaveBeenCalledTimes(2);
});

it("recovers a new account after the old account request stalls", async () => {
  const accept = vi.fn();
  const catalog = new GuiModelCatalog({ ready: () => true, accept });
  vi.mocked(guiApi.request).mockReturnValueOnce(new Promise(() => {})).mockResolvedValue(page([current]));
  const pending = catalog.invalidate();
  expect(catalog.invalidate()).toBe(pending);
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_TIMEOUT_MS);
  await pending;
  expect(accept).toHaveBeenCalledExactlyOnceWith([current]);
  await expect(catalog.ready()).resolves.toBeUndefined();
});

it("keeps a usable catalog and send guard when an ordinary background refresh times out", async () => {
  const accept = vi.fn();
  const syncing = vi.fn();
  const catalog = new GuiModelCatalog({ ready: () => true, accept, syncing });
  vi.mocked(guiApi.request).mockResolvedValueOnce(page([current]));
  await catalog.refresh();
  const guard = catalog.guard();
  syncing.mockClear();
  vi.mocked(guiApi.request).mockReturnValue(new Promise(() => {}));
  const failure = expect(catalog.refresh()).rejects.toThrow("模型加载超时");
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_TIMEOUT_MS);
  await failure;
  expect(guard()).toBe(true);
  expect(syncing).not.toHaveBeenCalled();
  expect(accept).toHaveBeenCalledExactlyOnceWith([current]);
});

it("bounds stalled settings reconciliation without treating a late completion as success", async () => {
  const stalled = deferred<void>();
  const syncing = vi.fn();
  const catalog = new GuiModelCatalog({ ready: () => true, accept: () => stalled.promise, syncing });
  vi.mocked(guiApi.request).mockResolvedValue(page([current]));
  const failure = expect(catalog.invalidate()).rejects.toThrow("模型加载超时");
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_TIMEOUT_MS);
  await failure;
  stalled.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(syncing).not.toHaveBeenCalledWith(false);
  await expect(catalog.ready()).rejects.toThrow("模型正在同步");
  await catalog.refresh();
  expect(syncing).toHaveBeenLastCalledWith(false);
});

it("clears pending deadlines on suspension and allows immediate reconnection", async () => {
  const failed = vi.fn();
  const catalog = new GuiModelCatalog({ ready: () => true, accept: vi.fn(), failed });
  vi.mocked(guiApi.request).mockReturnValueOnce(new Promise(() => {}));
  const pending = catalog.invalidate();
  catalog.suspend();
  await pending;
  expect(vi.getTimerCount()).toBe(0);
  expect(failed.mock.calls.every(([message]) => message === "")).toBe(true);
  catalog.activate();
  vi.mocked(guiApi.request).mockResolvedValue(page([current]));
  await catalog.invalidate();
  await expect(catalog.ready()).resolves.toBeUndefined();
});

it("rejects endless pagination even when each page responds immediately", async () => {
  let cursor = 0;
  vi.mocked(guiApi.request).mockImplementation(async () => ({ data: [], nextCursor: String(++cursor) }));
  const accept = vi.fn();
  const catalog = new GuiModelCatalog({ ready: () => true, accept });
  await expect(catalog.invalidate()).rejects.toThrow("模型列表");
  expect(accept).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps a valid catalog readable while an ordinary refresh stalls", async () => {
  vi.mocked(guiApi.request).mockResolvedValue(page([current]));
  const catalog = new GuiModelCatalog({ ready: () => true, accept: vi.fn() });
  await catalog.refresh();
  const stalled = deferred<unknown>();
  vi.mocked(guiApi.request).mockReturnValue(stalled.promise);
  const refreshing = catalog.refresh().catch(() => {});
  await expect(catalog.ready()).resolves.toBeUndefined();
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_TIMEOUT_MS);
  await refreshing;
  await expect(catalog.ready()).resolves.toBeUndefined();
  expect(catalog.guard()()).toBe(true);
});
