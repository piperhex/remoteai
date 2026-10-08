import { beforeEach, expect, it, vi } from 'vitest';
import { RemoteComposerSettings } from '../../../../shared/remote-chat/client/composerSettings';
import { initialChatState, type ChatState } from '../../../../shared/remote-chat/client/types';
import { MODEL_CATALOG_ERROR, type ComposerSnapshot } from '../../../../shared/remote-chat/composer';

const models = [{ id: 'model', model: 'model', displayName: 'Model', isDefault: true,
  defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }] }];
const snapshot = (revision: number, empty = false): ComposerSnapshot => ({
  models: empty ? [] : models, revision, threadId: null,
  settings: { model: empty ? '' : 'model', effort: empty ? '' : 'high', access: 'workspace-write' },
});
let state: ChatState;
let composer: RemoteComposerSettings;
const request = vi.fn();

beforeEach(() => {
  state = { ...initialChatState(), ready: true };
  request.mockReset().mockResolvedValue({ data: models, composer: snapshot(1) });
  composer = new RemoteComposerSettings({ snapshot: () => state, ready: () => state.ready,
    update: patch => { state = { ...state, ...patch }; }, request });
});

it('retains the current models and selection after an empty reconnect response', async () => {
  await composer.load();
  composer.reset();
  request.mockResolvedValue({ data: [], composer: snapshot(2, true) });
  await composer.load();
  expect(state).toMatchObject({ models, settings: snapshot(1).settings,
    settingsBusy: true, settingsError: MODEL_CATALOG_ERROR });
  composer.retry();
  expect(state.settingsBusy).toBe(true);
  request.mockResolvedValue({ data: models, composer: snapshot(3) });
  await composer.load();
  expect(state).toMatchObject({ models, settingsBusy: false, settingsError: '' });
});

it('retains models on empty events, ignores stale recovery and saves edits after a valid update', async () => {
  await composer.load();
  composer.receive({ ...snapshot(2), syncing: true });
  request.mockClear().mockResolvedValue({ ...snapshot(5), settings: { ...snapshot(5).settings, access: 'read-only' } });
  composer.set({ access: 'read-only' });
  composer.receive(snapshot(3, true));
  expect(state.models).toEqual(models);
  expect(state.settings.model).toBe('model');
  expect(state.settingsBusy).toBe(true);
  composer.receive(snapshot(2));
  composer.retry();
  expect(request).not.toHaveBeenCalled();
  composer.receive(snapshot(4));
  await vi.waitFor(() => expect(state.settingsBusy).toBe(false));
  expect(state.settingsError).toBe('');
  expect(request).toHaveBeenCalledExactlyOnceWith({ operation: 'composerSet', threadId: null,
    settings: { access: 'read-only' } });
});

it('preserves legacy hosts model caches after an empty response', async () => {
  request.mockResolvedValue({ data: models });
  await composer.load();
  request.mockResolvedValue({ data: [] });
  await composer.load();
  expect(state).toMatchObject({ models, settings: { model: 'model', effort: 'high' },
    settingsBusy: true, settingsError: MODEL_CATALOG_ERROR });
});

it('refreshes an unavailable catalog before retrying a pending settings change', async () => {
  await composer.load();
  composer.receive(snapshot(2, true));
  request.mockClear().mockResolvedValueOnce({ data: models, composer: snapshot(3) })
    .mockResolvedValueOnce({ ...snapshot(4), settings: { ...snapshot(4).settings, access: 'read-only' } });
  composer.set({ access: 'read-only' });
  await vi.waitFor(() => expect(state.settingsBusy).toBe(false));
  expect(request.mock.calls.map(([body]) => body.operation)).toEqual(['models', 'composerSet']);
  expect(state.settings).toMatchObject({ model: 'model', access: 'read-only' });
});

it('reports an empty first response without importing another conversation selection', async () => {
  request.mockResolvedValue({ data: [], composer: snapshot(1, true) });
  await composer.load();
  expect(state).toMatchObject({ models: [], settings: { model: '' },
    settingsBusy: true, settingsError: MODEL_CATALOG_ERROR });
  composer.receive(snapshot(2));
  expect(state.settingsBusy).toBe(false);
  state.selected = { id: 'other', cwd: '', preview: '', updatedAt: 1 };
  request.mockResolvedValue({ data: [], composer: { ...snapshot(3, true), threadId: 'other' } });
  await composer.select();
  expect(state.settings.model).toBe('');
  expect(state.settingsBusy).toBe(true);
});

it('does not acknowledge a pending edit when the save response has an empty catalog', async () => {
  await composer.load();
  request.mockResolvedValue(snapshot(2, true));
  composer.set({ access: 'read-only' });
  await vi.waitFor(() => expect(state.settingsError).toContain('电脑尚未确认设置'));
  expect(state.models).toEqual(models);
  expect(state.settings).toMatchObject({ model: 'model', access: 'read-only' });
  request.mockResolvedValue({ ...snapshot(3), settings: { ...snapshot(3).settings, access: 'read-only' } });
  composer.retry();
  await vi.waitFor(() => expect(state.settingsBusy).toBe(false));
  expect(request).toHaveBeenLastCalledWith({ operation: 'composerSet', threadId: null,
    settings: { access: 'read-only' } });
});
