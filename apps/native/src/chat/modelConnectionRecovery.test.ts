import { afterEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import { chatHandshake } from '../../../../shared/remote-chat/handshake';
import { DEFAULT_COMPOSER } from '../../../../shared/remote-chat/composer';

afterEach(() => vi.useRealTimers());

it('retries only models after a model failure and recovers without reconnecting', async () => {
  vi.useFakeTimers();
  let fail = true;
  const request = vi.fn(async (method: string, body?: Record<string, unknown>) => {
    if (method === 'connect') return { ...chatHandshake, approvals: [] };
    if (body?.operation === 'models') {
      if (fail) throw new Error('Model catalog unavailable');
      return { data: [{ id: 'test', model: 'test', displayName: 'test' }], nextCursor: null,
        composer: { revision: 1, models: [{ id: 'test', model: 'test', displayName: 'test' }],
          settings: { ...DEFAULT_COMPOSER, model: 'test' } } };
    }
    return { data: [], nextCursor: null };
  });
  const controller = new ChatController(events => ({
    start() { events.mode('relay'); events.ready(); }, stop() {},
    request: async <T>(method: string, body?: Record<string, unknown>) => await request(method, body) as T,
  }));
  controller.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(controller.snapshot()).toMatchObject({ ready: true, error: '', settingsBusy: true,
    settingsError: 'Model catalog unavailable' });
  const initialCalls = request.mock.calls.filter(([, body]) => body?.operation !== 'models').length;
  await vi.advanceTimersByTimeAsync(3000);
  expect(request.mock.calls.filter(([, body]) => body?.operation === 'models')).toHaveLength(2);
  expect(request.mock.calls.filter(([, body]) => body?.operation !== 'models')).toHaveLength(initialCalls);
  fail = false;
  await vi.advanceTimersByTimeAsync(3000);
  expect(controller.snapshot()).toMatchObject({ ready: true, settingsBusy: false, settingsError: '' });
  expect(request.mock.calls.filter(([method]) => method === 'connect')).toHaveLength(1);
  controller.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels pending model recovery when stopped', async () => {
  vi.useFakeTimers();
  const request = vi.fn(async (method: string, body?: Record<string, unknown>) => {
    if (method === 'connect') return { ...chatHandshake, approvals: [] };
    if (body?.operation === 'models') throw new Error('Model catalog unavailable');
    return { data: [], nextCursor: null };
  });
  const controller = new ChatController(events => ({
    start() { events.mode('relay'); events.ready(); }, stop() {},
    request: async <T>(method: string, body?: Record<string, unknown>) => await request(method, body) as T,
  }));
  controller.start();
  await vi.advanceTimersByTimeAsync(0);
  controller.stop();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(request.mock.calls.filter(([, body]) => body?.operation === 'models')).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});
