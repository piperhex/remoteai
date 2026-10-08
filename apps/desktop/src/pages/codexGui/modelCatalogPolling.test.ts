// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { subscribeToProviderEvents } from "../../api/backend";
import { guiApi } from "./api";
import { GuiModelCatalog } from "./modelCatalog";
import { MODEL_CATALOG_REFRESH_MS, watchModelCatalog } from "./modelCatalogRefresh";
import { MODEL_CATALOG_TIMEOUT_MS } from "./modelCatalogTimeout";
import { subscribeGuiEvent } from "./webEvents";
import type { Model } from "./types";

vi.mock("../../api/backend", () => ({ isHostedWebApp: true, subscribeToProviderEvents: vi.fn() }));
vi.mock("./api", () => ({ guiApi: { request: vi.fn() } }));
vi.mock("./webEvents", () => ({ subscribeGuiEvent: vi.fn() }));
const model: Model = { id: "model", model: "model", displayName: "Model", isDefault: true,
  defaultReasoningEffort: "high", supportedReasoningEfforts: [{ reasoningEffort: "high", description: "" }] };
let stop: () => void;
let poll: () => void | Promise<void>;
let accountChanged: () => void;

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers();
  vi.mocked(subscribeGuiEvent).mockImplementation(async (_name, callback) => {
    accountChanged = () => callback(undefined); return () => {};
  });
  vi.mocked(subscribeToProviderEvents).mockImplementation(callback => { poll = callback; return () => {}; });
});
afterEach(() => { stop?.(); vi.useRealTimers(); });

it("accepts a slow catalog despite repeated hosted Provider polls", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const accept = vi.fn();
  const catalog = new GuiModelCatalog({ ready: () => true, accept });
  stop = watchModelCatalog(catalog, vi.fn());
  const pending = catalog.invalidate();
  poll(); poll(); poll();
  finish({ data: [model], nextCursor: null });
  await pending;
  expect(guiApi.request).toHaveBeenCalledOnce();
  expect(accept).toHaveBeenCalledExactlyOnceWith([model]);
  await expect(catalog.ready()).resolves.toBeUndefined();
});

it("reports timeout instead of endlessly restarting a stalled catalog on hosted polls", async () => {
  vi.mocked(guiApi.request).mockReturnValue(new Promise(() => {}));
  const failed = vi.fn();
  const catalog = new GuiModelCatalog({ ready: () => true, accept: vi.fn(), failed });
  stop = watchModelCatalog(catalog, vi.fn());
  const failure = expect(catalog.invalidate()).rejects.toThrow("模型加载超时");
  for (let tick = 0; tick < 4; tick++) {
    poll();
    await vi.advanceTimersByTimeAsync(MODEL_CATALOG_TIMEOUT_MS / 4);
  }
  await failure;
  expect(guiApi.request).toHaveBeenCalledOnce();
  expect(failed).toHaveBeenLastCalledWith(expect.stringContaining("模型列表"));
});

it("does not invalidate a valid send guard while a scheduled refresh is pending", async () => {
  vi.mocked(guiApi.request).mockResolvedValueOnce({ data: [model], nextCursor: null });
  const syncing = vi.fn();
  const catalog = new GuiModelCatalog({ ready: () => true, accept: vi.fn(), syncing });
  await catalog.refresh();
  const guard = catalog.guard();
  syncing.mockClear();
  vi.mocked(guiApi.request).mockReturnValue(new Promise(() => {}));
  stop = watchModelCatalog(catalog, vi.fn());
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_REFRESH_MS);
  poll(); poll();
  expect(guiApi.request).toHaveBeenCalledTimes(2);
  expect(guard()).toBe(true);
  expect(syncing).not.toHaveBeenCalled();
  catalog.suspend();
  await vi.advanceTimersByTimeAsync(0);
});

it("refreshes every six hours without extra reads from hosted Provider polls", async () => {
  vi.mocked(guiApi.request).mockResolvedValue({ data: [model], nextCursor: null });
  const catalog = new GuiModelCatalog({ ready: () => true, accept: vi.fn() });
  stop = watchModelCatalog(catalog, vi.fn());
  poll();
  await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 - 1);
  poll();
  expect(guiApi.request).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(guiApi.request).toHaveBeenCalledOnce();
  poll(); poll();
  expect(guiApi.request).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
  expect(guiApi.request).toHaveBeenCalledTimes(2);
  stop();
  await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
  expect(guiApi.request).toHaveBeenCalledTimes(2);
});

it("refreshes account changes immediately without delaying the next scheduled check", async () => {
  vi.mocked(guiApi.request).mockResolvedValue({ data: [model], nextCursor: null });
  const catalog = new GuiModelCatalog({ ready: () => true, accept: vi.fn() });
  stop = watchModelCatalog(catalog, vi.fn());
  accountChanged();
  await vi.advanceTimersByTimeAsync(0);
  expect(guiApi.request).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
  accountChanged();
  await vi.advanceTimersByTimeAsync(0);
  expect(guiApi.request).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1000);
  expect(guiApi.request).toHaveBeenCalledTimes(3);
});
