// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { guiApi } from '../../../../../shared/conversation/api';
import { GuiController } from './controller';
import { GuiModelCatalog, MODEL_CATALOG_RETRY_MS } from './modelCatalog';
import { ComposerBridge } from './composerBridge';
import { ChatController } from '../../../../../shared/remote-chat/client/controller';
import { chatHandshake } from '../../../../../shared/remote-chat/handshake';
import type { Model } from '../../../../../shared/conversation/types';

vi.mock('../../../../../shared/conversation/api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
const model: Model = { id: 'available', model: 'available', displayName: 'Available', isDefault: true,
  defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }] };
const page = { data: [model], nextCursor: null };
let cleanup: (() => void)[];

beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); localStorage.clear(); cleanup = [];
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockResolvedValue(() => {});
  vi.mocked(guiApi.request).mockImplementation(async request => {
    if (request.operation === 'models') throw new Error('initial catalog failure');
    return { data: [], nextCursor: null };
  });
});
afterEach(() => { cleanup.forEach(stop => stop()); vi.clearAllTimers(); vi.useRealTimers(); });

function catalog() {
  const accept = vi.fn();
  const catalog = new GuiModelCatalog({ ready: () => true, accept });
  cleanup.push(() => catalog.suspend());
  return { catalog, accept };
}

it('recovers the host through remote reads without reconnecting the phone or computer', async () => {
  const pc = new GuiController();
  const bridge = new ComposerBridge();
  cleanup.push(() => pc.dispose(), bridge.attach(pc));
  await pc.connect();
  await expect(pc.modelCatalog.invalidate()).rejects.toThrow('initial catalog failure');
  const request = vi.fn(async (method: string, body?: Record<string, unknown>) => {
    if (method === 'connect') return { ...chatHandshake, approvals: [] };
    if (body?.operation === 'models') {
      const composer = await bridge.read(null);
      return { data: composer.models, nextCursor: null, composer };
    }
    return { data: [], nextCursor: null };
  });
  const phone = new ChatController(events => ({
    start() { events.mode('relay'); events.ready(); }, stop() {},
    request: async <T>(method: string, body?: Record<string, unknown>) => await request(method, body) as T,
  }));
  cleanup.push(() => phone.stop());
  vi.mocked(guiApi.request).mockResolvedValue(page);
  phone.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(phone.snapshot()).toMatchObject({ ready: true, settingsBusy: false, models: [model] });
  expect(pc.getSnapshot()).toMatchObject({ modelCatalogError: '', error: '' });
  expect(guiApi.connect).toHaveBeenCalledOnce();
  expect(request.mock.calls.filter(([method]) => method === 'connect')).toHaveLength(1);
  expect(vi.mocked(guiApi.request).mock.calls.filter(([body]) => body.operation === 'models')).toHaveLength(3);
});

it('automatically retries initial failure and removes the retry timer after success', async () => {
  const { catalog: value, accept } = catalog();
  await expect(value.invalidate()).rejects.toThrow('initial catalog failure');
  vi.mocked(guiApi.request).mockResolvedValue(page);
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_RETRY_MS);
  expect(accept).toHaveBeenCalledExactlyOnceWith([model]);
  await expect(value.ready()).resolves.toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

it('backs off repeated failures and cancels recovery when the session is suspended', async () => {
  const { catalog: value } = catalog();
  await expect(value.invalidate()).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_RETRY_MS);
  expect(guiApi.request).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_RETRY_MS);
  expect(guiApi.request).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_RETRY_MS);
  expect(guiApi.request).toHaveBeenCalledTimes(3);
  value.suspend();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(guiApi.request).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it('coalesces concurrent remote recovery with manual refresh', async () => {
  const { catalog: value } = catalog();
  await expect(value.invalidate()).rejects.toThrow();
  let finish!: (value: typeof page) => void;
  vi.mocked(guiApi.request).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const reads = [value.recover(), value.recover(), value.refresh()];
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_RETRY_MS);
  expect(guiApi.request).toHaveBeenCalledTimes(2);
  finish(page);
  await Promise.all(reads);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['failure', 'empty', 'stalled'] as const)(
  'keeps configured Provider models usable after %s CLI discovery and repairs capabilities later', async failure => {
    const { catalog: value, accept } = catalog();
    value.setProviderSource(async () => [model]);
    let finish: ((value: typeof page) => void) | undefined;
    if (failure === 'empty') vi.mocked(guiApi.request).mockResolvedValue({ data: [], nextCursor: null });
    if (failure === 'stalled') {
      vi.mocked(guiApi.request).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    }
    const loading = value.invalidate();
    await vi.advanceTimersByTimeAsync(MODEL_CATALOG_RETRY_MS);
    await loading;
    await expect(value.ready()).resolves.toBeUndefined();
    expect(accept).toHaveBeenCalledExactlyOnceWith([model]);
    const guard = value.guard();
    if (failure === 'stalled') {
      await vi.advanceTimersByTimeAsync(MODEL_CATALOG_RETRY_MS * 3);
      expect(guiApi.request).toHaveBeenCalledOnce();
      finish?.(page);
    }
    vi.mocked(guiApi.request).mockResolvedValue(page);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(guard()).toBe(true);
    expect(accept).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('does not substitute CLI models for an empty Provider configuration', async () => {
  const { catalog: value, accept } = catalog();
  value.setProviderSource(async () => []);
  vi.mocked(guiApi.request).mockResolvedValue(page);
  await expect(value.invalidate()).rejects.toThrow('模型列表');
  expect(accept).not.toHaveBeenCalled();
  expect(guiApi.request).not.toHaveBeenCalled();
});

it.each([false, true])('clears only the recovered model error, preserving a newer error: %s', async newerError => {
  const pc = new GuiController();
  cleanup.push(() => pc.dispose());
  vi.mocked(guiApi.request).mockResolvedValue(page);
  await pc.connect();
  vi.mocked(guiApi.request).mockRejectedValue(new Error('model read failed'));
  await pc.refreshModels().catch(pc.report);
  expect(pc.getSnapshot().error).toBe('model read failed');
  if (newerError) pc.report('another operation failed');
  vi.mocked(guiApi.request).mockResolvedValue(page);
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_RETRY_MS);
  expect(pc.getSnapshot().error).toBe(newerError ? 'another operation failed' : '');
  expect(pc.getSnapshot().modelCatalogError).toBe('');
});

it('discards old Provider capability results and refreshes the new source without overlapping requests', async () => {
  const { catalog: value, accept } = catalog();
  let models = [model];
  value.setProviderSource(async () => models);
  let finish!: (value: typeof page) => void;
  vi.mocked(guiApi.request).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const old = value.invalidate();
  await vi.advanceTimersByTimeAsync(0);
  const next = { ...model, id: 'new-provider', model: 'new-provider' };
  models = [next];
  const switched = value.invalidate();
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_RETRY_MS * 2);
  await Promise.all([old, switched]);
  expect(accept).toHaveBeenCalledExactlyOnceWith([next]);
  expect(guiApi.request).toHaveBeenCalledOnce();
  finish(page);
  vi.mocked(guiApi.request).mockResolvedValue({ data: [next], nextCursor: null });
  await vi.advanceTimersByTimeAsync(MODEL_CATALOG_RETRY_MS);
  expect(guiApi.request).toHaveBeenCalledTimes(2);
  expect(accept).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
