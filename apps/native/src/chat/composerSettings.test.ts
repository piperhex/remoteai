import { beforeEach, expect, it, vi } from 'vitest';
import { ChatController } from './controller';
vi.mock('react-native', () => ({ Platform: { OS: 'android' }, NativeModules: {} }));
vi.mock('../downloads/previews', () => ({ createPreviewDownloads: () => ({ dispose: vi.fn() }) }));
vi.mock('../downloads/iosPreviews', () => ({ createIosPreviewDownloads: vi.fn() }));
vi.mock('../downloads/manager', () => ({ downloadOwner: () => 'test-owner' }));
import type { AuthSession } from '../types';
import type { Thread } from './types';
import type { ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import { COMPOSER_EVENT, type ComposerSettings, type ComposerSnapshot } from '../../../../shared/remote-chat/composer';
import { historyDelta, type HistoryVersion } from '../../../../shared/remote-chat/historySync';

const mocks = vi.hoisted(() => ({ request: vi.fn(), events: null as ConnectionEvents | null }));
vi.mock('./connection', () => ({ MobileChatConnection: class {
  constructor(events: ConnectionEvents) { mocks.events = events; }
  start() { mocks.events!.mode('relay'); mocks.events!.ready(); }
  stop() {}
  request = mocks.request;
} }));
const session: AuthSession = { baseUrl: 'https://test', accessToken: 'test', refreshToken: 'test', email: 'test' };
const thread: Thread = { id: 'existing', preview: '', cwd: '/project', updatedAt: 1,
  turns: [{ id: 'earlier', status: 'completed', items: [] }] };
let pc: ComposerSnapshot;
beforeEach(() => {
  mocks.request.mockReset();
  pc = { revision: 1, settings: { model: 'first', effort: 'medium', access: 'workspace-write' },
    models: ['first', 'second'].map((model) => ({ id: model, model, displayName: model,
      isDefault: model === 'first', defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: ['medium', 'high', 'xhigh']
        .map((reasoningEffort) => ({ reasoningEffort, description: '' })),
    })) };
  mocks.request.mockImplementation(async (method: string, body?: {
    operation: string; settings?: Partial<ComposerSettings>; known?: HistoryVersion;
  }) => {
    if (method === 'connect') return [];
    if (body?.operation === 'models') return { data: pc.models, nextCursor: null, composer: pc };
    if (body?.operation === 'syncHistory') return historyDelta(thread, body.known);
    if (body?.operation === 'composerSet') {
      pc = { ...pc, revision: pc.revision + 1, settings: { ...pc.settings, ...body.settings } };
      return pc;
    }
    return { data: [thread], nextCursor: null };
  });
});

async function existingChat() {
  const controller = new ChatController(session, 'computer');
  controller.start();
  await vi.waitFor(() => expect(controller.snapshot().ready).toBe(true));
  await controller.select(thread);
  mocks.request.mockClear();
  return controller;
}

it('keeps existing-chat settings editable offline and synchronizes them before another send', async () => {
  const controller = await existingChat();
  await controller.setSettings({});
  expect(controller.snapshot().settingsBusy).toBe(false);
  mocks.events!.mode('offline');
  await controller.setSettings({ model: 'second', effort: 'xhigh', access: 'read-only' });
  expect(controller.snapshot()).toMatchObject({ selected: thread, settingsBusy: true,
    settings: { model: 'second', effort: 'xhigh', access: 'read-only' } });
  expect(mocks.request).not.toHaveBeenCalled();
  expect(await controller.send({ text: 'next', ...controller.snapshot().settings })).toBe(false);
  mocks.events!.mode('relay');
  mocks.events!.ready();
  await vi.waitFor(() => expect(controller.snapshot().settingsBusy).toBe(false));
  expect(pc.settings).toEqual({ model: 'second', effort: 'xhigh', access: 'read-only' });
  expect(controller.snapshot().settings).toEqual(pc.settings);
  controller.stop();
});

it('accepts more edits during a slow save and sends only one settings request at a time', async () => {
  const controller = await existingChat();
  let finish: (value: ComposerSnapshot) => void = () => undefined;
  mocks.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await controller.setSettings({ effort: 'high' });
  await controller.setSettings({ model: 'second' });
  await controller.setSettings({ effort: 'xhigh', access: 'danger-full-access' });
  expect(mocks.request).toHaveBeenCalledTimes(1);
  pc = { ...pc, revision: 2, settings: { ...pc.settings, effort: 'high' } };
  mocks.events!.event({ method: COMPOSER_EVENT, params: pc });
  expect(controller.snapshot().settings).toEqual({ model: 'second', effort: 'xhigh', access: 'danger-full-access' });
  finish(pc);
  await vi.waitFor(() => expect(controller.snapshot().settingsBusy).toBe(false));
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(pc.settings).toEqual(controller.snapshot().settings);
  controller.stop();
});

it('retains choices after a rejected save, reports the failure and lets a later edit retry', async () => {
  const controller = await existingChat();
  mocks.request.mockRejectedValueOnce(new Error('保存暂未完成'));
  await controller.setSettings({ effort: 'high' });
  await vi.waitFor(() => expect(controller.snapshot().settingsError).toBe('保存暂未完成'));
  expect(controller.snapshot().settings.effort).toBe('high');
  expect(await controller.send({ text: 'next', ...controller.snapshot().settings })).toBe(false);
  await controller.setSettings({ access: 'read-only' });
  await vi.waitFor(() => expect(controller.snapshot().settingsBusy).toBe(false));
  expect(controller.snapshot().settingsError).toBe('');
  expect(pc.settings).toMatchObject({ effort: 'high', access: 'read-only' });
  controller.stop();
});

it('keeps a later PC change when an earlier save acknowledgement arrives', async () => {
  const controller = await existingChat();
  let finish: (value: ComposerSnapshot) => void = () => undefined;
  mocks.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await controller.setSettings({ effort: 'high' });
  const acknowledgement = { ...pc, revision: 2, settings: { ...pc.settings, effort: 'high' } };
  pc = { ...pc, revision: 3, settings: { ...pc.settings, effort: 'xhigh' } };
  mocks.events!.event({ method: COMPOSER_EVENT, params: pc });
  finish(acknowledgement);
  await vi.waitFor(() => expect(controller.snapshot().settingsBusy).toBe(false));
  expect(controller.snapshot().settings.effort).toBe('xhigh');
  controller.stop();
});

it('synchronizes speed both ways and clears its pending save before another message', async () => {
  pc.settings.speed = 'normal';
  const controller = await existingChat();
  await controller.setSettings({ speed: 'fast' });
  await vi.waitFor(() => expect(controller.snapshot().settingsBusy).toBe(false));
  expect(pc.settings.speed).toBe('fast');
  expect(mocks.request).toHaveBeenCalledWith('request', { operation: 'composerSet', settings: { speed: 'fast' } });
  pc = { ...pc, revision: pc.revision + 1, settings: { ...pc.settings, speed: 'normal' } };
  mocks.events!.event({ method: COMPOSER_EVENT, params: pc });
  expect(controller.snapshot().settings.speed).toBe('normal');
  controller.stop();
});

it('blocks sends and defers edits until the PC finishes switching the model source', async () => {
  const controller = await existingChat();
  pc = { ...pc, revision: pc.revision + 1, syncing: true };
  mocks.events!.event({ method: COMPOSER_EVENT, params: pc });
  expect(controller.snapshot().settingsBusy).toBe(true);
  expect(await controller.send({ text: 'must wait', ...controller.snapshot().settings })).toBe(false);
  await controller.setSettings({ effort: 'xhigh' });
  expect(mocks.request).not.toHaveBeenCalled();
  pc = { ...pc, revision: pc.revision + 1, syncing: false,
    models: [pc.models[1]], settings: { ...pc.settings, model: 'second' } };
  mocks.events!.event({ method: COMPOSER_EVENT, params: pc });
  await vi.waitFor(() => expect(controller.snapshot().settingsBusy).toBe(false));
  expect(controller.snapshot().settings).toMatchObject({ model: 'second', effort: 'xhigh' });
  expect(mocks.request).toHaveBeenCalledExactlyOnceWith('request', {
    operation: 'composerSet', settings: { effort: 'xhigh' },
  });
  controller.stop();
});

it('preserves a newer speed choice while the previous save is acknowledged', async () => {
  pc.settings.speed = 'normal';
  const controller = await existingChat();
  let finish!: (value: ComposerSnapshot) => void;
  mocks.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await controller.setSettings({ speed: 'fast' });
  await controller.setSettings({ speed: 'normal' });
  expect(mocks.request).toHaveBeenCalledTimes(1);
  pc = { ...pc, revision: pc.revision + 1, settings: { ...pc.settings, speed: 'fast' } };
  mocks.events!.event({ method: COMPOSER_EVENT, params: pc });
  expect(controller.snapshot().settings.speed).toBe('normal');
  finish(pc);
  await vi.waitFor(() => expect(controller.snapshot().settingsBusy).toBe(false));
  expect(pc.settings.speed).toBe('normal');
  expect(mocks.request).toHaveBeenCalledTimes(2);
  controller.stop();
});
