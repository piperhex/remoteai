// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ComposerBridge } from './composerBridge';
import { GuiController } from './controller';
import { guiApi } from '../../../../../shared/conversation/api';
import type { ModelSettingsApi, ModelSettingsSnapshot } from './threadModelSettings';
import type { Model } from '../../../../../shared/conversation/types';
import { ChatController } from '../../../../../shared/remote-chat/client/controller';
import { COMPOSER_EVENT, composerThreadId } from '../../../../../shared/remote-chat/composer';
import { emptyQueue } from '../../../../../shared/remote-chat/queue';
import { historyDelta } from '../../../../../shared/remote-chat/historySync';
import type { ConnectionEvents } from '../../../../../shared/remote-chat/client/connection';

vi.mock('../../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn(), connect: vi.fn(), subscribe: vi.fn() } }));
const models: Model[] = [{ id: 'model', model: 'model', displayName: 'Model', isDefault: true,
  defaultReasoningEffort: 'low', supportedReasoningEfforts: ['low', 'high', 'xhigh'].map(reasoningEffort =>
    ({ reasoningEffort, description: '' })) }];
let pc: GuiController;
let bridge: ComposerBridge;
let saved: Map<string | null, ModelSettingsSnapshot>;
let api: ModelSettingsApi;
let cleanup: (() => void)[];

beforeEach(async () => {
  localStorage.clear(); vi.resetAllMocks(); cleanup = []; saved = new Map();
  const listeners = new Set<(snapshot: ModelSettingsSnapshot) => void>();
  api = {
    read: vi.fn(async threadId => saved.get(threadId) ?? { threadId, selection: null, revision: 0 }),
    write: vi.fn(async (threadId, selection) => {
      const snapshot = { threadId, selection, revision: (saved.get(threadId)?.revision ?? 0) + 1 };
      saved.set(threadId, snapshot); listeners.forEach(listener => listener(snapshot)); return snapshot;
    }),
    subscribe: async listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  vi.mocked(guiApi.request).mockImplementation(async request => request.operation === 'read'
    ? { thread: { id: request.threadId, cwd: '', preview: '', updatedAt: 1 } } : { data: models, nextCursor: null });
  pc = new GuiController(); await pc.setModels(models);
  cleanup.push(pc.modelSettings.start(api));
  bridge = new ComposerBridge(); cleanup.push(bridge.attach(pc));
  await pc.modelSettings.ready(null);
});
afterEach(() => { cleanup.forEach(stop => stop()); pc.dispose(); });

it('isolates phone settings from the PC conversation and its new-conversation defaults', async () => {
  await pc.select('pc'); pc.settings({ effort: 'low' });
  await bridge.update({ effort: 'high' }, 'phone');
  expect(pc.getSnapshot()).toMatchObject({ selected: 'pc', settings: { effort: 'low' } });
  expect(saved.get('phone')?.selection?.effort).toBe('high');
  const events = vi.fn(); cleanup.push(bridge.subscribe(events));
  pc.newConversation(); await pc.modelSettings.ready(null);
  expect((await bridge.read('phone')).settings.effort).toBe('high');
  expect(events.mock.calls.some(([snapshot]) => snapshot.threadId === 'phone' && snapshot.settings.effort === 'low'))
    .toBe(false);
  await pc.select('phone');
  expect(pc.getSnapshot().settings.effort).toBe('high');
});

it('inherits the current choice when starting a new PC conversation and persists it', async () => {
  await pc.select('pc'); pc.settings({ effort: 'xhigh' }); await pc.modelSettings.ready('pc');
  pc.newConversation();
  expect((await bridge.read(null)).settings.effort).toBe('xhigh');
  expect(saved.get(null)?.selection?.effort).toBe('xhigh');
  expect(saved.get('pc')?.selection?.effort).toBe('xhigh');
});

it('waits for a slow save instead of acknowledging an unpersisted remote choice', async () => {
  await bridge.read('phone');
  let finish!: (snapshot: ModelSettingsSnapshot) => void;
  vi.mocked(api.write).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let acknowledged = false;
  const update = bridge.update({ effort: 'high' }, 'phone').then(result => { acknowledged = true; return result; });
  await vi.waitFor(() => expect(api.write).toHaveBeenCalled());
  await pc.select('another');
  expect(acknowledged).toBe(false);
  expect(pc.getSnapshot().selected).toBe('another');
  finish({ threadId: 'phone', selection: { model: 'model', effort: 'high' }, revision: 1 });
  expect((await update).settings.effort).toBe('high');
});

it('rejects a failed remote save while retaining the choice for a later retry', async () => {
  vi.mocked(api.write).mockRejectedValueOnce(new Error('private storage detail'));
  await expect(bridge.update({ effort: 'high' }, 'phone')).rejects.toThrow('模型设置暂未同步');
  expect(pc.modelSettings.selection('phone').effort).toBe('high');
  await expect(bridge.update({ effort: 'xhigh' }, 'phone')).resolves.toMatchObject({
    threadId: 'phone', settings: { effort: 'xhigh' },
  });
  await expect(bridge.update({ effort: 'xhigh' }, 'another')).resolves.toMatchObject({ threadId: 'another' });
});

async function connectPhone(request: <T>(method: string, body?: unknown) => Promise<T>) {
  let phoneEvents!: ConnectionEvents;
  const phone = new ChatController(events => {
    phoneEvents = events;
    return { request, start: () => { events.mode('relay'); events.ready(); }, stop: () => {} };
  });
  cleanup.push(() => phone.stop());
  cleanup.push(bridge.subscribe(snapshot => phoneEvents.event({ method: COMPOSER_EVENT, params: snapshot })));
  phone.start(); await vi.waitFor(() => expect(phone.snapshot().ready).toBe(true));
  return phone;
}

it('persists the phone-created selection before sending and keeps it after PC navigation', async () => {
  const created = { id: 'phone-created', cwd: '', preview: '', updatedAt: 1, turns: [] };
  const request = vi.fn(async (method: string, body?: Record<string, unknown>) => {
    if (method === 'connect') return [];
    if (body?.operation === 'models') {
      const composer = await bridge.read(composerThreadId(body.threadId));
      return { data: models, nextCursor: null, composer };
    }
    if (body?.operation === 'composerSet') return bridge.update(body.settings, composerThreadId(body.threadId));
    if (body?.operation === 'start') return { thread: created };
    if (body?.operation === 'send') {
      expect(saved.get(created.id)?.selection?.effort).toBe('high');
      expect(body.effort).toBe('high');
      return {};
    }
    if (body?.operation === 'syncHistory') return historyDelta(created);
    if (body?.operation === 'queueRead' || body?.operation === 'queueEnqueue') return emptyQueue();
    return { data: [], nextCursor: null };
  });
  const phone = await connectPhone(request as <T>(method: string, body?: unknown) => Promise<T>);
  await phone.setSettings({ effort: 'high', access: 'danger-full-access' });
  await vi.waitFor(() => expect(phone.snapshot().settingsBusy).toBe(false));
  await pc.select('pc');
  expect(pc.getSnapshot().settings.effort).toBe('low');
  expect(await phone.send({ text: 'phone probe', access: phone.snapshot().settings.access })).toBe(true);
  expect(request).toHaveBeenCalledWith('request', expect.objectContaining({
    operation: 'start', access: 'danger-full-access',
  }));
  pc.newConversation(); await pc.modelSettings.ready(null);
  expect(phone.snapshot().settings.effort).toBe('high');
  await pc.select(created.id);
  expect(pc.getSnapshot().settings.effort).toBe('high');
  expect(await phone.send({ text: 'follow up', access: phone.snapshot().settings.access })).toBe(true);
  expect(request).toHaveBeenCalledWith('request', expect.objectContaining({ operation: 'queueEnqueue',
    threadId: created.id, model: 'model', effort: 'high', access: 'danger-full-access' }));
  request.mockClear();
  phone.back();
  await vi.waitFor(() => expect(phone.snapshot().settingsBusy).toBe(false));
  expect(phone.snapshot().settings.access).toBe('danger-full-access');
  expect(request).toHaveBeenCalledWith('request', expect.objectContaining({ operation: 'composerSet',
    threadId: null, settings: expect.objectContaining({ access: 'danger-full-access' }) }));
});

it('restores the last phone permission for new conversations after the PC reopens', async () => {
  await bridge.update({ access: 'danger-full-access' }, 'phone');
  const reopened = new GuiController();
  const restoredBridge = new ComposerBridge();
  await reopened.setModels(models);
  cleanup.push(restoredBridge.attach(reopened)); cleanup.push(() => reopened.dispose());
  expect((await restoredBridge.read(null)).settings.access).toBe('danger-full-access');
});
