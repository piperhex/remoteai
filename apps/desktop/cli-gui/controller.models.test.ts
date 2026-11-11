import { expect, it, vi } from 'vitest';
import { CliController } from '../../../shared/cli-gui/controller';
import type { CliCatalog, CliRequest, CliSession, CliTransport } from '../../../shared/cli-gui/types';

const nativeCatalog: CliCatalog = { status: 'ready', models: [{ id: 'sonnet', label: 'Sonnet' }], modes: [] };
const session: CliSession = { id: 'native-old', engine: 'claude', model: 'old-sonnet', title: 'Old', cwd: '',
  status: 'idle', archived: false, permissions: [], updatedAt: '2026-11-11' };
function setup(catalog: (request: CliRequest) => Promise<CliCatalog> = async () => nativeCatalog) {
  const calls: CliRequest[] = [];
  let accountChanged = () => {};
  const request: CliTransport['request'] = async <T>(input: CliRequest) => {
    calls.push(input);
    if (input.action === 'status') return { status: 'ready', version: 'test' } as T;
    if (input.action === 'list') return [] as T;
    if (input.action === 'catalog') return await catalog(input) as T;
    if (input.action === 'read') return { session, entries: [], hasOlder: false } as T;
    if (input.action === 'create') return { ...session, id: 'created', model: input.model } as T;
    return {} as T;
  };
  const controller = new CliController({ request, subscribe: () => () => {},
    subscribeAccountChange: listener => { accountChanged = listener; return () => {}; } });
  return { controller, calls, changeAccount: () => accountChanged() };
}

it('sends a native Claude draft with its own model and no invented reasoning parameter', async () => {
  const { controller, calls } = setup();
  await controller.refresh(); controller.chooseEngine('claude');
  await vi.waitFor(() => expect(controller.getSnapshot().model).toBe('sonnet'));
  controller.edit('Hello'); await controller.send();
  expect(calls).toContainEqual(expect.objectContaining({ action: 'create', model: 'sonnet', effort: undefined }));
  expect(calls).toContainEqual(expect.objectContaining({ action: 'send', model: 'sonnet', effort: undefined }));
});

it('preserves a fixed old model when the account changes and rejects a missing selection', async () => {
  let fixed = true;
  const { controller, calls, changeAccount } = setup(async () => fixed
    ? { ...nativeCatalog, models: [{ id: session.model, label: 'Old Sonnet' }] } : nativeCatalog);
  const stop = controller.start(); await controller.refresh(); controller.open(session);
  await vi.waitFor(() => expect(controller.getSnapshot().catalog?.models[0].id).toBe(session.model));
  changeAccount();
  await vi.waitFor(() => expect(controller.getSnapshot().catalog?.models[0].id).toBe(session.model));
  expect(controller.getSnapshot().model).toBe(session.model);
  controller.edit('Continue'); await controller.send();
  expect(calls).toContainEqual(expect.objectContaining({ action: 'send', model: session.model }));
  fixed = false; await controller.loadCatalog(); controller.edit('Unavailable');
  const sent = calls.filter(call => call.action === 'send').length;
  await controller.send();
  expect(controller.getSnapshot().model).toBe(session.model);
  expect(calls.filter(call => call.action === 'send')).toHaveLength(sent);
  stop();
});

it('blocks sends while loading and discards a late catalog from another CLI', async () => {
  let release!: (value: CliCatalog) => void;
  const pending = new Promise<CliCatalog>(resolve => { release = resolve; });
  const gemini: CliCatalog = { ...nativeCatalog, models: [{ id: 'gemini', label: 'Gemini', defaultEffort: 'none' }] };
  const { controller, calls } = setup(request => request.engine === 'claude' ? pending : Promise.resolve(gemini));
  await controller.refresh(); controller.chooseEngine('claude'); controller.edit('Wait');
  await vi.waitFor(() => expect(calls.some(call => call.action === 'catalog')).toBe(true));
  await controller.send(); expect(calls.some(call => call.action === 'create')).toBe(false);
  controller.chooseEngine('gemini');
  await vi.waitFor(() => expect(controller.getSnapshot().model).toBe('gemini'));
  release(nativeCatalog); await Promise.resolve();
  expect(controller.getSnapshot()).toMatchObject({ engine: 'gemini', model: 'gemini', effort: 'none', catalog: gemini });
});

it('keeps invalid reasoning choices visible but blocks sending them', async () => {
  const catalog: CliCatalog = { ...nativeCatalog, models: [{ id: 'gpt-6', label: 'GPT-6', defaultEffort: 'high',
    efforts: [{ id: 'high', label: 'High' }, { id: 'low', label: 'Low' }] }] };
  const { controller, calls } = setup(async () => catalog);
  await controller.refresh(); controller.chooseEngine('gemini');
  await vi.waitFor(() => expect(controller.getSnapshot().model).toBe('gpt-6'));
  controller.patch({ effort: 'ultra', draft: 'Hello' }); await controller.send();
  expect(calls.some(call => call.action === 'send')).toBe(false);
  controller.patch({ effort: 'low' }); await controller.send();
  expect(calls).toContainEqual(expect.objectContaining({ action: 'send', model: 'gpt-6', effort: 'low' }));
});
