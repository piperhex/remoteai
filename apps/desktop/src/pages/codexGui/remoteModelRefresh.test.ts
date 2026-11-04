// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { guiApi } from '../../../../../shared/conversation/api';
import { GuiController } from './controller';
import { ComposerBridge } from './composerBridge';
import { ChatController } from '../../../../../shared/remote-chat/client/controller';
import { chatHandshake } from '../../../../../shared/remote-chat/handshake';
import type { Model } from '../../../../../shared/conversation/types';

vi.mock('../../../../../shared/conversation/api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
const model: Model = { id: 'recovered', model: 'recovered', displayName: 'Recovered', isDefault: true,
  defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }] };
const page = { data: [model], nextCursor: null };
const cleanup: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); localStorage.clear();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockResolvedValue(() => {});
});
afterEach(() => { cleanup.splice(0).forEach(stop => stop()); vi.clearAllTimers(); vi.useRealTimers(); });

it('preserves the selected model when an older host refreshes only the catalog', async () => {
  let models = [model];
  const request = vi.fn(async (method: string, body?: Record<string, unknown>) => {
    if (method === 'connect') return { ...chatHandshake, approvals: [] };
    return { data: body?.operation === 'models' || body?.operation === 'modelsRefresh' ? models : [],
      nextCursor: null };
  });
  const phone = new ChatController(events => ({
    start() { events.mode('relay'); events.ready(); }, stop() {},
    request: async <T>(method: string, body?: Record<string, unknown>) => await request(method, body) as T,
  }));
  cleanup.push(() => phone.stop());
  phone.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(phone.snapshot().settings).toMatchObject({ model: model.model, effort: 'high' });
  models = [{ ...model, id: 'other', model: 'other' }];
  await phone.refreshModels();
  expect(phone.snapshot().models).toEqual(models);
  expect(phone.snapshot().settings).toMatchObject({ model: model.model, effort: 'high' });
  expect(await phone.send({ text: 'blocked', access: 'workspace-write' })).toBe(false);
  expect(request.mock.calls.some(([, body]) => body?.operation === 'composerSet')).toBe(false);
});

it.each(['empty', 'corrupt'])('recovers %s cache through a phone/Web action while polls stay passive', async mode => {
  const discover = vi.fn<() => Promise<typeof page>>();
  vi.mocked(guiApi.request).mockImplementation(async request => {
    if (request.operation !== 'models') return { data: [], nextCursor: null };
    if (!request.cacheOnly) return discover();
    if (mode === 'corrupt') throw new Error('Invalid cached JSON');
    return { data: [], nextCursor: null };
  });
  const pc = new GuiController();
  const bridge = new ComposerBridge();
  cleanup.push(() => pc.dispose(), bridge.attach(pc));
  await pc.connect();
  const request = vi.fn(async (method: string, body?: Record<string, unknown>) => {
    if (method === 'connect') return { ...chatHandshake, approvals: [] };
    if (body?.operation === 'models' || body?.operation === 'modelsRefresh') {
      const composer = body.operation === 'modelsRefresh' ? await bridge.refreshModels(null) : await bridge.read(null);
      return { data: composer.models, nextCursor: null, composer };
    }
    return { data: [], nextCursor: null };
  });
  const phone = new ChatController(events => ({
    start() { events.mode('relay'); events.ready(); }, stop() {},
    request: async <T>(method: string, body?: Record<string, unknown>) => await request(method, body) as T,
  }));
  cleanup.push(() => phone.stop());
  phone.start();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(phone.snapshot().settingsBusy).toBe(true);
  expect(discover).not.toHaveBeenCalled();
  let finish!: (value: typeof page) => void;
  discover.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const refreshing = [phone.refreshModels(), phone.refreshModels()];
  const responsive = vi.fn();
  const timer = setInterval(responsive, 2000);
  await vi.advanceTimersByTimeAsync(6000);
  clearInterval(timer);
  expect(responsive).toHaveBeenCalledTimes(3);
  expect(discover).toHaveBeenCalledOnce();
  expect(phone.snapshot().settingsBusy).toBe(true);
  finish(page);
  await Promise.all(refreshing);
  expect(phone.snapshot()).toMatchObject({ ready: true, settingsBusy: false, settingsError: '', models: [model] });
  await expect(bridge.validateSend({ model: model.model })).resolves.toMatchObject({ model: model.model });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(discover).toHaveBeenCalledOnce();
  expect(guiApi.connect).toHaveBeenCalledOnce();
});
