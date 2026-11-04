// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '../../api/backend';
import { guiApi } from '../../../../../shared/conversation/api';
import { ComposerBridge } from './composerBridge';
import { GuiController } from './controller';
import { watchModelCatalog } from './modelCatalogRefresh';
import { readGuiProviderModels } from './providerModelSource';
import { subscribeGuiEvent } from '../../../../../shared/conversation/webEvents';
import type { GuiAccountSelection } from '../../../../../shared/remote-chat/guiAccounts';
import type { ModelSettingsApi, ModelSettingsSnapshot } from './threadModelSettings';
import type { Model } from '../../../../../shared/conversation/types';

vi.mock('../../api/backend', () => ({ invoke: vi.fn(), isHostedWebApp: false,
  subscribeToProviderEvents: () => () => {} }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
vi.mock('../../../../../shared/conversation/api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
vi.mock('../../../../../shared/conversation/webEvents', () => ({ subscribeGuiEvent: vi.fn() }));
const model = (name: string): Model => ({ id: name, model: name, displayName: name, isDefault: true,
  defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }] });
let selection: GuiAccountSelection;
let pc: GuiController;
let bridge: ComposerBridge;
let api: ModelSettingsApi;
let saved: Map<string | null, ModelSettingsSnapshot>;
let cleanup: (() => void)[];

beforeEach(async () => {
  vi.resetAllMocks(); localStorage.clear(); cleanup = []; saved = new Map();
  selection = { kind: 'provider', id: 'a' };
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === 'codex_gui_account_selection') return selection;
    if (command === 'list_providers') return ['a', 'b'].map(id => ({ id, kind: 'custom', active: id === 'a',
      model: `model-${id}`, models: [`model-${id}`], modelSelectionControlledByCodex: true,
      modelReasoningEfforts: { [`model-${id}`]: ['high'] } }));
    throw new Error(`Unexpected command: ${command}`);
  });
  vi.mocked(subscribeGuiEvent).mockResolvedValue(() => {});
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockResolvedValue(() => {});
  vi.mocked(guiApi.request).mockImplementation(async request => request.operation === 'read'
    ? { thread: { id: request.threadId, cwd: '', preview: '', updatedAt: 1 } }
    : { data: request.operation === 'models' ? [model('model-a')] : [], nextCursor: null });
  const listeners = new Set<(snapshot: ModelSettingsSnapshot) => void>();
  api = {
    read: vi.fn(async threadId => saved.get(threadId) ?? { threadId, selection: null, revision: 0 }),
    write: vi.fn(async (threadId, next) => {
      const snapshot = { threadId, selection: next, revision: (saved.get(threadId)?.revision ?? 0) + 1,
        liveUpdate: 'applied' as const };
      saved.set(threadId, snapshot); listeners.forEach(listener => listener(snapshot)); return snapshot;
    }),
    subscribe: async listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  pc = new GuiController();
  pc.modelCatalog.setProviderSource(readGuiProviderModels);
  cleanup.push(pc.modelSettings.start(api));
  bridge = new ComposerBridge(); cleanup.push(bridge.attach(pc));
  cleanup.push(watchModelCatalog(pc.modelCatalog, pc.report));
  await pc.connect();
});
afterEach(() => { cleanup.forEach(stop => stop()); pc.dispose(); });

it('switches the phone catalog with no PC page mounted and ignores shared Provider active flags', async () => {
  await bridge.read('phone');
  const events = vi.fn(); cleanup.push(bridge.subscribe(events));
  selection = { kind: 'provider', id: 'b' };
  vi.mocked(subscribeGuiEvent).mock.calls[0][1](selection);
  expect(pc.getSnapshot().modelCatalogLoading).toBe(true);
  expect(await pc.send('must wait', [])).toBe(false);
  expect(events).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'phone', syncing: true }));
  await pc.modelCatalog.ready();
  expect((await bridge.read('phone')).settings.model).toBe('model-a');
  expect(pc.getSnapshot().settings.model).toBe('model-a');
  expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ threadId: 'phone', syncing: false }));
  await expect(bridge.update({ model: 'model-a' }, 'phone')).rejects.toThrow('这个模型已不可用');
  await expect(bridge.validateSend({ threadId: 'phone', model: 'model-a' })).rejects.toThrow('当前账户不支持');
  await expect(bridge.validateSend({ threadId: 'phone', model: 'model-b' })).rejects.toThrow('当前账户不支持');
  await bridge.update({ model: 'model-b' }, 'phone');
  await expect(bridge.validateSend({ threadId: 'phone', model: 'model-b' }))
    .resolves.toMatchObject({ model: 'model-b' });
});

it('does not acknowledge a switch before both routing and the new CLI catalog are ready', async () => {
  let finishSwitch!: () => void;
  let finishModels!: (value: unknown) => void;
  let acknowledged = false;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise(resolve => { finishModels = resolve; }));
  const switching = pc.modelCatalog.switchSource(async () => {
    await new Promise<void>(resolve => { finishSwitch = resolve; });
    selection = { kind: 'provider', id: 'b' };
  }).then(() => { acknowledged = true; });
  const overlapping = vi.fn();
  await expect(pc.modelCatalog.switchSource(overlapping)).rejects.toThrow('正在切换账户');
  expect(overlapping).not.toHaveBeenCalled();
  expect(pc.getSnapshot().modelCatalogLoading).toBe(true);
  await expect(bridge.update({ model: 'model-a' }, null)).rejects.toThrow('模型正在同步');
  finishSwitch();
  await vi.waitFor(() => expect(finishModels).toBeTypeOf('function'));
  expect(acknowledged).toBe(false);
  finishModels({ data: [model('model-b')], nextCursor: null });
  await switching;
  expect(pc.getSnapshot().modelCatalogLoading).toBe(false);
  expect((await bridge.read(null)).settings.model).toBe('model-a');
});

it('keeps sending blocked when the new Provider cannot be read and recovers on the next refresh', async () => {
  selection = { kind: 'provider', id: 'b' };
  pc.modelCatalog.setProviderSource(async () => { throw new Error('offline'); });
  await expect(pc.modelCatalog.invalidate()).rejects.toThrow('offline');
  expect(pc.getSnapshot().modelCatalogLoading).toBe(true);
  expect(await pc.send('must wait', [])).toBe(false);
  await expect(bridge.validateSend({ model: 'model-a' })).rejects.toThrow('offline');
  pc.modelCatalog.setProviderSource(readGuiProviderModels);
  await pc.modelCatalog.refresh();
  expect((await bridge.read(null)).settings.model).toBe('model-a');
});

it('preserves saved, live and queued choices without writes when the account catalog changes', async () => {
  await bridge.update({ model: 'model-a' }, 'phone');
  await bridge.update({ model: 'model-a' }, 'old');
  await pc.loadRemoteThread('phone');
  vi.mocked(guiApi.subscribe).mock.calls[0][0]({ method: 'turn/started', params: { threadId: 'phone',
    turn: { id: 'live', status: 'inProgress', items: [] } } });
  pc.queue.enqueue('phone', { text: 'next', images: [], skills: [] });
  await pc.select('pc');
  vi.mocked(api.write).mockClear();
  selection = { kind: 'provider', id: 'b' };
  await pc.modelCatalog.invalidate();
  expect(pc.getSnapshot().selected).toBe('pc');
  expect(saved.get('phone')?.selection).toEqual({ model: 'model-a', effort: 'high' });
  expect(saved.get('old')?.selection).toEqual({ model: 'model-a', effort: 'high' });
  expect(pc.getSnapshot().queued.phone[0]).toMatchObject({ model: 'model-a', effort: 'high' });
  expect(api.write).not.toHaveBeenCalled();
  const changes = pc.getSnapshot().conversations.phone.turns.flatMap(turn => turn.items)
    .filter(item => item.type === 'modelChange');
  expect(changes).toEqual([]);
  await pc.select('old');
  expect(pc.getSnapshot().settings).toMatchObject({ model: 'model-a', effort: 'high' });
  expect(await pc.send('blocked', [])).toBe(false);
  await expect(bridge.validateSend({ threadId: 'old' })).rejects.toThrow('当前账户不支持');
  selection = { kind: 'provider', id: 'a' };
  await pc.modelCatalog.invalidate();
  await expect(bridge.validateSend({ threadId: 'old' })).resolves.toMatchObject({ model: 'model-a', effort: 'high' });
  expect(api.write).not.toHaveBeenCalled();
});

it('returns to the official catalog when switching away from a custom Provider', async () => {
  selection = { kind: 'account', id: 'official' };
  vi.mocked(guiApi.request).mockResolvedValue({ data: [model('official-model')], nextCursor: null });
  await pc.modelCatalog.invalidate();
  expect((await bridge.read(null)).models.map(entry => entry.model)).toEqual(['official-model']);
});

it('rechecks a queued message after its resume overlaps a Provider switch', async () => {
  await pc.loadRemoteThread('phone');
  await bridge.update({ model: 'model-a' }, 'phone');
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  let finishResume!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementation(request => request.operation === 'resume'
    ? new Promise(resolve => { finishResume = resolve; }) : original(request));
  pc.queue.enqueue('phone', { text: 'queued before switching', images: [], skills: [] });
  const flushing = pc.queue.flush('phone');
  await vi.waitFor(() => expect(finishResume).toBeTypeOf('function'));
  selection = { kind: 'provider', id: 'b' };
  await pc.modelCatalog.invalidate();
  vi.mocked(guiApi.request).mockImplementation(async request => {
    if (request.operation === 'resume') return { thread: { id: 'phone', cwd: '', preview: '', updatedAt: 1 } };
    if (request.operation === 'sendBatch') return { turn: { id: 'sent', status: 'completed', items: [] } };
    return original(request);
  });
  finishResume({ thread: { id: 'phone', cwd: '', preview: '', updatedAt: 1 } });
  await flushing;
  expect(vi.mocked(guiApi.request).mock.calls.filter(([request]) => request.operation === 'sendBatch')).toHaveLength(0);
  expect(pc.getSnapshot().queued.phone[0]).toMatchObject({ model: 'model-a', effort: 'high' });
  selection = { kind: 'provider', id: 'a' };
  await pc.modelCatalog.invalidate();
  await vi.waitFor(() => expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({
    operation: 'sendBatch', model: 'model-a',
  })));
  expect(vi.mocked(guiApi.request).mock.calls.filter(([request]) => request.operation === 'sendBatch')).toHaveLength(1);
});
