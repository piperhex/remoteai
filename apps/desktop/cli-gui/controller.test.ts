import { describe, expect, it, vi } from 'vitest';
import { CliController, mergeEntries } from '../../../shared/cli-gui/controller';
import type { CliHistory, CliRequest, CliSession, CliTransport } from '../../../shared/cli-gui/types';

const conversation = (id: string, engine: 'claude' | 'gemini' = 'claude'): CliSession => ({
  id, engine, title: id, cwd: '/project', model: 'test', status: 'idle', updatedAt: '2026-11-10',
  archived: false, permissions: [],
});
const history = (session: CliSession): CliHistory => ({ session, entries: [], hasOlder: false });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function setup(intercept?: (request: CliRequest) => Promise<unknown> | undefined) {
  const calls: CliRequest[] = [];
  const request: CliTransport['request'] = async <T>(input: CliRequest): Promise<T> => {
    calls.push(input);
    const pending = intercept?.(input);
    if (pending) return await pending as T;
    if (input.action === 'status') return { status: 'ready', version: '0.15.4',
      cliVersion: input.engine === 'claude' ? '2.0.1' : '0.25.2' } as T;
    if (input.action === 'list') return [] as T;
    if (input.action === 'catalog') return { status: 'ready', models: [{ id: 'test', label: 'Test' }], modes: [] } as T;
    if (input.action === 'read') return history(conversation(input.id, input.engine)) as T;
    if (input.action === 'create') return conversation('created', input.engine) as T;
    return {} as T;
  };
  const controller = new CliController({ request, subscribe: () => () => {} });
  return { controller, calls };
}

describe('per-conversation CLI state', () => {
  it.each(['claude', 'gemini'] as const)('sends %s projectless drafts with the original permission ID', async engine => {
    const { controller, calls } = setup();
    await controller.refresh();
    controller.patch({ engine, model: 'test', cwd: '', mode: 'plan', draft: 'A general question' });
    await controller.loadCatalog();
    controller.patch({ mode: 'plan' });
    await controller.send();
    expect(calls).toContainEqual(expect.objectContaining({ engine, action: 'create', cwd: '', mode: 'plan' }));
    expect(calls).toContainEqual(expect.objectContaining({ engine, action: 'send', text: 'A general question' }));
  });

  it('keeps drafts and versions separate and locks existing conversations', async () => {
    const { controller } = setup();
    await controller.refresh();
    controller.chooseEngine('claude'); controller.edit('Claude draft');
    controller.chooseEngine('gemini'); controller.edit('Gemini draft');
    controller.chooseEngine('claude');
    expect(controller.getSnapshot().draft).toBe('Claude draft');
    controller.open(conversation('existing'));
    controller.chooseEngine('gemini');
    expect(controller.getSnapshot().engine).toBe('claude');
    expect(controller.getSnapshot().runtime.gemini?.cliVersion).toBe('0.25.2');
  });

  it('loads the latest selection when a previous refresh completes late', async () => {
    const firstRead = deferred<CliHistory>();
    const { controller } = setup(input => input.action === 'read' && input.id === 'first'
      ? firstRead.promise : undefined);
    controller.open(conversation('first'));
    await vi.waitFor(() => expect(controller.getSnapshot().runtime.claude?.status).toBe('ready'));
    controller.open(conversation('second', 'gemini'));
    firstRead.resolve(history(conversation('first')));
    await vi.waitFor(() => expect(controller.getSnapshot().history?.session.id).toBe('second'));
    expect(controller.getSnapshot().engine).toBe('gemini');
  });

  it('does not replace another conversation when a create response arrives late', async () => {
    const created = deferred<CliSession>();
    const { controller, calls } = setup(input => input.action === 'create' ? created.promise : undefined);
    await controller.refresh();
    controller.chooseEngine('claude'); controller.patch({ cwd: '/project', model: 'test' }); controller.edit('hello');
    await controller.loadCatalog();
    const sending = controller.send();
    controller.showCodex();
    created.resolve(conversation('created'));
    await sending;
    expect(controller.getSnapshot().engine).toBe('codex');
    expect(controller.getSnapshot().selected).toBeNull();
    expect(calls.find(input => input.action === 'send')).toMatchObject({ engine: 'claude', id: 'created', text: 'hello' });
  });

  it('preserves failed messages and forwards exact permission choices to their owner', async () => {
    const { controller, calls } = setup(input => input.action === 'send'
      ? Promise.reject(new Error('client.cliGui.connectionFailed')) : undefined);
    controller.open(conversation('existing', 'gemini')); controller.edit('retry me');
    await vi.waitFor(() => expect(controller.getSnapshot().catalog?.status).toBe('ready'));
    await controller.send();
    expect(controller.getSnapshot().draft).toBe('retry me');
    await controller.act({ engine: 'gemini', action: 'approve', id: 'existing',
      permissionId: 'pending-1', actionId: 'allow_once:42' });
    expect(calls.at(-1)?.engine).toBeDefined();
    expect(calls).toContainEqual({ engine: 'gemini', action: 'approve', id: 'existing',
      permissionId: 'pending-1', actionId: 'allow_once:42' });
  });

  it('loads archived histories without allowing new messages', async () => {
    const { controller, calls } = setup();
    controller.filter(true);
    await vi.waitFor(() => expect(calls.some(input => input.action === 'list' && input.archived)).toBe(true));
    controller.open({ ...conversation('archived'), archived: true });
    controller.edit('do not send');
    await controller.send();
    expect(calls.some(input => input.action === 'send')).toBe(false);
  });

  it('replaces overlapping streamed history entries instead of duplicating text', () => {
    const entry = { id: '1', first: 1, last: 2, role: 'assistant' as const, text: 'Hello' };
    expect(mergeEntries([entry], [{ ...entry, last: 4, text: 'Hello world' }]))
      .toEqual([{ ...entry, last: 4, text: 'Hello world' }]);
  });
});
