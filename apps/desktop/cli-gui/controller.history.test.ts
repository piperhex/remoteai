import { describe, expect, it, vi } from 'vitest';
import { CliController } from '../../../shared/cli-gui/controller';
import type { CliEntry, CliHistory, CliRequest, CliSession, CliTransport } from '../../../shared/cli-gui/types';

const session: CliSession = { id: 'chat', engine: 'claude', title: 'chat', cwd: '', model: 'test',
  status: 'running', updatedAt: '2026-11-11', archived: false, permissions: [] };
const entry = (first: number, text: string, last = first): CliEntry =>
  ({ id: String(first), first, last, role: 'assistant', text });
const history = (entries: CliEntry[], epoch = 'original'): CliHistory => ({ session, entries,
  cursor: { epoch, seq: entries[0]?.first ?? 0 }, hasOlder: true });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function setup() {
  let page = deferred<CliHistory>();
  let latest = history([entry(10, 'partial', 11)]);
  const calls: CliRequest[] = [];
  const request: CliTransport['request'] = async <T>(input: CliRequest): Promise<T> => {
    calls.push(input);
    if (input.action === 'read') return await (input.cursor ? page.promise : latest) as T;
    if (input.action === 'status') return { status: 'ready' } as T;
    if (input.action === 'list') return [] as T;
    return { models: [], modes: [] } as T;
  };
  const controller = new CliController({ request, subscribe: () => () => {} });
  controller.patch({ engine: 'claude', selected: session, history: latest });
  return { controller, page, calls, nextPage: () => { page = deferred<CliHistory>(); return page; },
    refresh: async (value: CliHistory) => {
    latest = value; await controller.refresh();
  } };
}

describe('CLI history pagination races', () => {
  it('merges into the completed refresh, retains new messages and deduplicates overlap', async () => {
    const { controller, page, refresh, calls } = setup();
    const reading = controller.loadOlder();
    const latest = { ...history([entry(10, 'final reply', 13), entry(14, 'new message')]),
      session: { ...session, status: 'idle', permissions: [{ id: 'new', title: 'approval', actions: [] }] } };
    await refresh(latest);
    expect(controller.getSnapshot().loading).toBe(true);
    await controller.loadOlder();
    expect(calls.filter(input => input.action === 'read' && input.cursor)).toHaveLength(1);
    page.resolve({ ...history([entry(1, 'older'), entry(10, 'partial', 11)]), hasOlder: false });
    await reading;
    expect(controller.getSnapshot().history).toEqual({ ...latest, hasOlder: false,
      cursor: { epoch: 'original', seq: 1 }, entries: [entry(1, 'older'), ...latest.entries] });
    expect(controller.getSnapshot().selected).toEqual(latest.session);
    expect(controller.getSnapshot().loading).toBe(false);
  });

  it.each(['epoch', 'identity', 'clear', 'reopen', 'stop'] as const)(
    'discards an older response after %s invalidates its lifetime', async change => {
      const { controller, page, refresh } = setup();
      const stop = controller.start();
      await controller.refresh();
      const reading = controller.loadOlder();
      if (change === 'epoch') await refresh(history([entry(30, 'replacement')], 'replacement'));
      if (change === 'identity') controller.open({ ...session, id: 'other', engine: 'gemini' });
      if (change === 'clear') controller.newConversation();
      if (change === 'reopen') controller.open(session);
      if (change === 'stop') stop();
      await controller.refresh();
      await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
      const before = controller.getSnapshot();
      page.resolve(history([entry(1, 'stale')]));
      await reading;
      expect(controller.getSnapshot()).toEqual(before);
      stop();
    });

  it('ignores a response carrying another epoch or conversation identity', async () => {
    for (const change of ['epoch', 'identity'] as const) {
      const { controller, page } = setup();
      const original = controller.getSnapshot().history;
      const reading = controller.loadOlder();
      const result = history([entry(1, 'wrong')], change === 'epoch' ? 'other' : 'original');
      if (change === 'identity') result.session = { ...session, engine: 'gemini' };
      page.resolve(result); await reading;
      expect(controller.getSnapshot().history).toBe(original);
      expect(controller.getSnapshot().loading).toBe(false);
    }
  });

  it('keeps the cursor on failure, allows retry and clears the pagination error', async () => {
    const { controller, page, nextPage } = setup();
    const original = controller.getSnapshot().history;
    const reading = controller.loadOlder();
    page.reject(new Error('page failed')); await reading;
    expect(controller.getSnapshot()).toMatchObject({ history: original, loading: false, error: 'page failed' });
    const replacement = nextPage();
    const retry = controller.loadOlder();
    expect(controller.getSnapshot()).toMatchObject({ loading: true, error: '' });
    replacement.resolve(history([entry(1, 'retry succeeded')]));
    await retry;
    expect(controller.getSnapshot().history?.entries[0].text).toBe('retry succeeded');
    expect(controller.getSnapshot()).toMatchObject({ loading: false, error: '' });
  });

  it('does not report an old failure into a newly selected conversation', async () => {
    const { controller, page } = setup();
    const reading = controller.loadOlder();
    controller.newConversation();
    page.reject(new Error('stale failure')); await reading;
    expect(controller.getSnapshot()).toMatchObject({ history: null, loading: false, error: '' });
  });

  it('accepts an empty terminal page without losing the current history or its epoch', async () => {
    const { controller, page } = setup();
    const original = controller.getSnapshot().history!;
    const reading = controller.loadOlder();
    page.resolve({ session, entries: [], hasOlder: false });
    await reading;
    expect(controller.getSnapshot().history).toEqual({ ...original, hasOlder: false });
    expect(controller.getSnapshot().loading).toBe(false);
  });

  it('does not let the previous lifetime release the next page loading state', async () => {
    const { controller, page, nextPage } = setup();
    const old = controller.loadOlder();
    controller.newConversation();
    controller.open(session);
    await vi.waitFor(() => expect(controller.getSnapshot().history).not.toBeNull());
    const replacement = nextPage();
    const next = controller.loadOlder();
    page.resolve(history([entry(1, 'stale')])); await old;
    expect(controller.getSnapshot().loading).toBe(true);
    replacement.resolve(history([entry(2, 'current')])); await next;
    expect(controller.getSnapshot().history?.entries.map(item => item.text)).toEqual(['current', 'partial']);
  });
});
