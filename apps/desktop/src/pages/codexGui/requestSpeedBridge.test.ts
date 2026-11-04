import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '../../api/backend';
import { subscribeGuiEvent } from '../../../../../shared/conversation/webEvents';
import { RequestSpeedBridge } from './requestSpeedBridge';

vi.mock('../../api/backend', () => ({ invoke: vi.fn() }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
vi.mock('../../../../../shared/conversation/webEvents', () => ({ subscribeGuiEvent: vi.fn() }));
const normal = { running: true, fastModeEnabled: false };
const fast = { ...normal, fastModeEnabled: true };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(invoke).mockResolvedValue(normal);
  vi.mocked(subscribeGuiEvent).mockResolvedValue(vi.fn());
});
afterEach(() => vi.useRealTimers());

it('uses the same host switch as the PC and reads the confirmed mode', async () => {
  const bridge = new RequestSpeedBridge();
  expect(await bridge.read()).toBe('normal');
  vi.mocked(invoke).mockResolvedValueOnce(fast);
  expect(await bridge.set('fast')).toBe('fast');
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_set_request_speed', { speed: 'fast' });
  vi.mocked(invoke).mockResolvedValueOnce({ ...fast, speed: 'ultrafast' });
  expect(await bridge.set('ultrafast')).toBe('ultrafast');
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_set_request_speed', { speed: 'ultrafast' });
  expect(await bridge.set('normal')).toBe('normal');
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_set_request_speed', { speed: 'normal' });
});

it('coalesces a slow poll and serializes a subsequent mode change after it', async () => {
  let resolve!: (value: typeof normal) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const bridge = new RequestSpeedBridge();
  const read = bridge.read();
  expect(bridge.read()).toBe(read);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  vi.mocked(invoke).mockResolvedValueOnce(fast);
  const change = bridge.set('fast');
  expect(bridge.read()).toBe(change);
  expect(invoke).toHaveBeenCalledOnce();
  resolve(normal);
  expect(await change).toBe('fast');
  expect(invoke).toHaveBeenCalledTimes(2);
});

it('publishes PC changes through events and polling and stops after the last subscriber leaves', async () => {
  vi.useFakeTimers();
  const stopEvents = vi.fn();
  vi.mocked(subscribeGuiEvent).mockResolvedValue(stopEvents);
  const bridge = new RequestSpeedBridge();
  const listener = vi.fn();
  const stop = bridge.subscribe(listener);
  await bridge.read();
  expect(listener).toHaveBeenLastCalledWith('normal');
  vi.mocked(invoke).mockResolvedValue(fast);
  vi.mocked(subscribeGuiEvent).mock.calls[0][1]({});
  await bridge.read();
  expect(listener).toHaveBeenLastCalledWith('fast');
  vi.mocked(invoke).mockResolvedValue(normal);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(listener).toHaveBeenLastCalledWith('normal');
  stop();
  expect(stopEvents).toHaveBeenCalledOnce();
  const requests = vi.mocked(invoke).mock.calls.length;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(invoke).toHaveBeenCalledTimes(requests);
});

it('keeps backend details out of failures and permits a later retry', async () => {
  const bridge = new RequestSpeedBridge();
  await bridge.read();
  vi.mocked(invoke).mockRejectedValueOnce('private host details');
  await expect(bridge.set('fast')).rejects.toThrow('速度模式未能切换');
  vi.mocked(invoke).mockResolvedValueOnce(fast);
  expect(await bridge.set('fast')).toBe('fast');
});

it('keeps GUI fast mode when the external proxy is stopped', async () => {
  vi.mocked(invoke).mockResolvedValue({ ...fast, running: false });
  expect(await new RequestSpeedBridge().read()).toBe('fast');
});
