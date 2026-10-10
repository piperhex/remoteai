import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RemoteComposerSettings } from '../../../../shared/remote-chat/client/composerSettings';
import { initialChatState, type ChatState } from '../../../../shared/remote-chat/client/types';
import type { ComposerSnapshot } from '../../../../shared/remote-chat/composer';

const snapshot: ComposerSnapshot = { revision: 1, threadId: null,
  models: [{ id: 'model', model: 'model', displayName: 'Model', isDefault: true,
    defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }] }],
  settings: { model: 'model', effort: 'high', access: 'workspace-write' } };
const response = { data: snapshot.models, composer: snapshot };
let state: ChatState;
let composer: RemoteComposerSettings;
const request = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  state = { ...initialChatState(), ready: true };
  request.mockReset().mockRejectedValue(new Error('Catalog unavailable'));
  composer = new RemoteComposerSettings({ snapshot: () => state, ready: () => state.ready,
    update: patch => { state = { ...state, ...patch }; }, request });
});
afterEach(() => { composer.reset(); vi.useRealTimers(); });

it('keeps model recovery single-flight and sending blocked until the read completes', async () => {
  await expect(composer.load()).rejects.toThrow('Catalog unavailable');
  let finish!: (value: typeof response) => void;
  request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  composer.retry();
  composer.retry();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(request).toHaveBeenCalledTimes(2);
  expect(state.settingsBusy).toBe(true);
  finish(response);
  await vi.advanceTimersByTimeAsync(0);
  expect(state).toMatchObject({ settingsBusy: false, settingsError: '', models: snapshot.models });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(request).toHaveBeenCalledTimes(2);
});

it('recovers from a PC update and skips the scheduled read', async () => {
  request.mockResolvedValueOnce(response);
  await composer.load();
  await expect(composer.load()).rejects.toThrow('Catalog unavailable');
  composer.receive({ ...snapshot, revision: 2, syncing: true });
  expect(state.settingsBusy).toBe(true);
  composer.receive({ ...snapshot, revision: 3 });
  expect(state).toMatchObject({ settingsBusy: false, settingsError: '' });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(request).toHaveBeenCalledTimes(2);
});

it('discards a late failure after disconnect instead of starting another retry', async () => {
  let fail!: (error: Error) => void;
  request.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
  const loading = composer.load().catch(() => undefined);
  composer.reset();
  state.ready = false;
  fail(new Error('Disconnected'));
  await loading;
  await vi.advanceTimersByTimeAsync(30_000);
  expect(request).toHaveBeenCalledOnce();
  expect(state.settingsError).toBe('');
  expect(vi.getTimerCount()).toBe(0);
});
