// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { subscribeToProviderEvents } from "../../api/backend";
import { guiApi } from "../../../../../shared/conversation/api";
import { GuiModelCatalog } from "./modelCatalog";
import { watchModelCatalog } from "./modelCatalogRefresh";
import { subscribeGuiEvent } from "../../../../../shared/conversation/webEvents";
import type { Model } from "../../../../../shared/conversation/types";

const backend = vi.hoisted(() => ({ hosted: true }));
vi.mock("../../api/backend", () => ({ get isHostedWebApp() { return backend.hosted; },
  subscribeToProviderEvents: vi.fn() }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
vi.mock("../../../../../shared/conversation/api", () => ({ guiApi: { request: vi.fn() } }));
vi.mock("../../../../../shared/conversation/webEvents", () => ({ subscribeGuiEvent: vi.fn() }));
const model: Model = { id: "model", model: "model", displayName: "Model", isDefault: true,
  defaultReasoningEffort: "high", supportedReasoningEfforts: [{ reasoningEffort: "high", description: "" }] };
const DAY_MS = 24 * 60 * 60 * 1000;
let stop: () => void;
let accountChanged: () => void;

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); backend.hosted = true;
  vi.mocked(subscribeGuiEvent).mockImplementation(async (_name, callback) => {
    accountChanged = () => callback(undefined); return () => {};
  });
  vi.mocked(guiApi.request).mockResolvedValue({ data: [model], nextCursor: null });
  vi.mocked(subscribeToProviderEvents).mockReturnValue(() => {});
});
afterEach(() => { stop?.(); vi.clearAllTimers(); vi.useRealTimers(); });

it("never polls models or subscribes to synthetic hosted Provider polling", async () => {
  const catalog = new GuiModelCatalog({ ready: () => true, accept: vi.fn() });
  stop = watchModelCatalog(catalog, vi.fn());
  await vi.advanceTimersByTimeAsync(DAY_MS);
  expect(subscribeToProviderEvents).not.toHaveBeenCalled();
  expect(guiApi.request).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("refreshes actual account changes but does not follow them with periodic requests", async () => {
  const accept = vi.fn();
  const catalog = new GuiModelCatalog({ ready: () => true, accept });
  stop = watchModelCatalog(catalog, vi.fn());
  accountChanged();
  await vi.advanceTimersByTimeAsync(0);
  expect(guiApi.request).toHaveBeenCalledOnce();
  expect(accept).toHaveBeenCalledExactlyOnceWith([model]);
  await vi.advanceTimersByTimeAsync(DAY_MS);
  expect(guiApi.request).toHaveBeenCalledOnce();
  accountChanged();
  await vi.advanceTimersByTimeAsync(0);
  expect(guiApi.request).toHaveBeenCalledTimes(2);
  stop(); accountChanged();
  await vi.advanceTimersByTimeAsync(DAY_MS);
  expect(guiApi.request).toHaveBeenCalledTimes(2);
});

it("retains desktop Provider change refreshes while idle time never triggers a request", async () => {
  backend.hosted = false;
  const catalog = new GuiModelCatalog({ ready: () => true, accept: vi.fn() });
  stop = watchModelCatalog(catalog, vi.fn());
  expect(subscribeToProviderEvents).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(DAY_MS);
  expect(guiApi.request).not.toHaveBeenCalled();
  await vi.mocked(subscribeToProviderEvents).mock.calls[0][0]();
  await vi.advanceTimersByTimeAsync(0);
  expect(guiApi.request).toHaveBeenCalledOnce();
  await expect(catalog.ready()).resolves.toBeUndefined();
});
