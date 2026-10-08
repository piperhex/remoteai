// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "./api";
import { GuiController } from "./controller";
import { ComposerBridge } from "./composerBridge";
import { GuiModelCatalog } from "./modelCatalog";
import { MODEL_CATALOG_REFRESH_MS, watchModelCatalog } from "./modelCatalogRefresh";
import { subscribeGuiEvent } from "./webEvents";
import type { Model } from "./types";

vi.mock("./api", () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
vi.mock("./webEvents", () => ({ subscribeGuiEvent: vi.fn() }));
vi.mock("../../api/backend", () => ({ isHostedWebApp: false, subscribeToProviderEvents: () => () => {} }));
const model = (name: string): Model => ({ id: name, model: name, displayName: name, isDefault: true,
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: ["low", "medium", "high"].map((reasoningEffort) => ({ reasoningEffort, description: "" })),
});
const existing = model("gpt-6-sol");
const released = model("gpt-6.1-sol");

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockResolvedValue(vi.fn());
  vi.mocked(subscribeGuiEvent).mockResolvedValue(vi.fn());
});
afterEach(() => vi.useRealTimers());

it("publishes new upstream models to desktop and remote clients during an active turn", async () => {
  const controller = new GuiController();
  const bridge = new ComposerBridge();
  const detach = bridge.attach(controller);
  vi.mocked(guiApi.request).mockImplementation(async (request) => ({
    data: request.operation === "models" ? [existing] : [], nextCursor: null,
  }));
  await controller.connect();
  controller.settings({ model: existing.model, effort: "high" });
  const receive = vi.mocked(guiApi.subscribe).mock.calls[0][0];
  receive({ method: "thread/started", params: { thread: { id: "live", cwd: "", preview: "", updatedAt: 1 } } });
  receive({ method: "turn/started", params: { threadId: "live",
    turn: { id: "turn", status: "inProgress", items: [] } } });
  const live = controller.getSnapshot().conversations.live;
  const published = vi.fn();
  const stop = bridge.subscribe(published);
  vi.mocked(guiApi.request).mockResolvedValue({ data: [released, existing], nextCursor: null });
  await controller.modelCatalog.refresh();
  expect(controller.getSnapshot().models).toEqual([released, existing]);
  expect(controller.getSnapshot().settings).toMatchObject({ model: existing.model, effort: "high" });
  expect(controller.getSnapshot().conversations.live).toBe(live);
  expect(guiApi.connect).toHaveBeenCalledOnce();
  expect((await bridge.read()).models).toEqual([released, existing]);
  expect(published).toHaveBeenCalledWith(expect.objectContaining({ models: [released, existing] }));
  expect((await bridge.update({ model: released.model })).settings)
    .toMatchObject({ model: released.model, effort: "medium" });
  stop(); detach(); controller.dispose();
});

it("coalesces menu and timer refreshes, paginates, and drops an old account response", async () => {
  const accept = vi.fn();
  const catalog = new GuiModelCatalog({ ready: () => true, accept });
  let finish!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce({ data: [released], nextCursor: "page-2" })
    .mockResolvedValueOnce({ data: [existing], nextCursor: null });
  const pending = catalog.refresh();
  expect(catalog.refresh()).toBe(pending);
  expect(catalog.invalidate()).toBe(pending);
  finish({ data: [model("old-account")], nextCursor: "stale-page" });
  await pending;
  expect(guiApi.request).toHaveBeenCalledTimes(3);
  expect(guiApi.request).toHaveBeenLastCalledWith({ operation: "models", cursor: "page-2" });
  expect(accept).toHaveBeenCalledExactlyOnceWith([released, existing]);
});

it("keeps the last successful catalog after failure and ignores results after suspension", async () => {
  const accept = vi.fn();
  const catalog = new GuiModelCatalog({ ready: () => true, accept });
  vi.mocked(guiApi.request).mockResolvedValueOnce({ data: [existing], nextCursor: null });
  await catalog.refresh();
  vi.mocked(guiApi.request).mockRejectedValueOnce(new Error("offline"));
  await expect(catalog.refresh()).rejects.toThrow("offline");
  let finish!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = catalog.refresh();
  catalog.suspend();
  finish({ data: [released], nextCursor: null });
  await pending;
  await catalog.refresh();
  expect(accept).toHaveBeenCalledExactlyOnceWith([existing]);
});

it("stops polling and unsubscribes even when the subscription finishes after cleanup", async () => {
  vi.useFakeTimers();
  const catalog = new GuiModelCatalog({ ready: () => true, accept: vi.fn() });
  let subscribe!: (stop: () => void) => void;
  vi.mocked(subscribeGuiEvent).mockImplementation(() => new Promise((resolve) => { subscribe = resolve; }));
  let finish!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const stop = watchModelCatalog(catalog, vi.fn());
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_REFRESH_MS);
  expect(catalog.refresh()).toBe(catalog.refresh());
  expect(guiApi.request).toHaveBeenCalledOnce();
  stop(); catalog.suspend();
  const unsubscribe = vi.fn();
  subscribe(unsubscribe);
  finish({ data: [existing], nextCursor: null });
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_REFRESH_MS * 3);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(guiApi.request).toHaveBeenCalledOnce();
});

it("keeps ordinary polling quiet when the catalog has not changed", async () => {
  const accept = vi.fn(); const syncing = vi.fn();
  const catalog = new GuiModelCatalog({ ready: () => true, accept, syncing });
  vi.mocked(guiApi.request).mockResolvedValue({ data: [existing], nextCursor: null });
  await catalog.refresh();
  const current = catalog.guard();
  accept.mockClear(); syncing.mockClear();
  await catalog.refresh();
  expect(accept).not.toHaveBeenCalled();
  expect(syncing).not.toHaveBeenCalled();
  expect(current()).toBe(true);
  vi.mocked(guiApi.request).mockResolvedValue({ data: [released], nextCursor: null });
  await catalog.refresh();
  expect(current()).toBe(false);
});

it("keeps a failed settings reconciliation blocked without repeatedly retrying it", async () => {
  const accept = vi.fn().mockRejectedValue(new Error("save failed"));
  const catalog = new GuiModelCatalog({ ready: () => true, accept });
  vi.mocked(guiApi.request).mockResolvedValue({ data: [existing], nextCursor: null });
  await expect(catalog.invalidate()).rejects.toThrow("save failed");
  expect(accept).toHaveBeenCalledOnce();
  await expect(catalog.ready()).rejects.toThrow("模型正在同步");
});

it("keeps models and conversation choices when the CLI returns an empty catalog during polling", async () => {
  vi.mocked(guiApi.request).mockImplementation(async request => ({
    data: request.operation === "models" ? [existing] : [], nextCursor: null,
  }));
  const controller = new GuiController();
  const bridge = new ComposerBridge();
  const detach = bridge.attach(controller);
  await controller.connect();
  controller.settings({ model: existing.model, effort: "high" });
  const previous = await bridge.read(null);
  const guard = controller.modelCatalog.guard();
  const changed = vi.fn();
  const stop = bridge.subscribe(changed);
  vi.mocked(guiApi.request).mockResolvedValue({ data: [], nextCursor: null });
  await expect(controller.modelCatalog.refresh()).rejects.toThrow("模型列表");
  expect(controller.getSnapshot()).toMatchObject({ models: [existing], modelCatalogLoading: false,
    settings: { model: existing.model, effort: "high" }, modelCatalogError: expect.stringContaining("模型列表") });
  expect(await bridge.read(null)).toEqual(previous);
  expect(changed).not.toHaveBeenCalled();
  expect(guard()).toBe(true);
  vi.mocked(guiApi.request).mockResolvedValue({ data: [existing, released], nextCursor: null });
  await controller.refreshModels();
  expect((await bridge.read(null)).models).toEqual([existing, released]);
  expect(controller.getSnapshot().modelCatalogError).toBe("");
  stop(); detach(); controller.dispose();
});

it("preserves the old catalog for display but keeps a source switch blocked after an empty response", async () => {
  const accept = vi.fn();
  const syncing = vi.fn();
  const catalog = new GuiModelCatalog({ ready: () => true, accept, syncing });
  vi.mocked(guiApi.request).mockResolvedValueOnce({ data: [existing], nextCursor: null });
  await catalog.refresh();
  const guard = catalog.guard();
  vi.mocked(guiApi.request).mockResolvedValue({ data: [], nextCursor: null });
  await expect(catalog.switchSource(async () => {})).rejects.toThrow("模型列表");
  expect(accept).toHaveBeenCalledExactlyOnceWith([existing]);
  expect(guard()).toBe(false);
  expect(syncing).toHaveBeenLastCalledWith(true);
  await expect(catalog.ready()).rejects.toThrow("模型正在同步");
  vi.mocked(guiApi.request).mockResolvedValue({ data: [released], nextCursor: null });
  await catalog.refresh();
  expect(accept).toHaveBeenLastCalledWith([released]);
  await expect(catalog.ready()).resolves.toBeUndefined();
});

it("accepts a nonempty catalog with an empty pagination page", async () => {
  const accept = vi.fn();
  const catalog = new GuiModelCatalog({ ready: () => true, accept });
  vi.mocked(guiApi.request).mockResolvedValueOnce({ data: [], nextCursor: "next" })
    .mockResolvedValueOnce({ data: [existing], nextCursor: null });
  await catalog.refresh();
  expect(accept).toHaveBeenCalledExactlyOnceWith([existing]);
});
