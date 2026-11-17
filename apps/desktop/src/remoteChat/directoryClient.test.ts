import { expect, it, vi } from 'vitest';
import { RemoteDirectory } from '../../../../shared/remote-chat/client/directory';
import { DirectoryJournal } from '../../../../shared/chat/directory/journal';
import { DirectoryWriter } from '../../../../shared/chat/directory/storage';
import { directoryScope, summaryEntry, type ChatDirectoryEntry } from '../../../../shared/chat/directory/documents';
import { directoryIconHash } from '../../../../shared/chat/directory/icons';
import { CONNECTION_ERRORS } from '../../../../shared/remote-chat/connectionErrors';

const query = { archived: false, search: '' };
const row = (name: string) => summaryEntry({ id: 'one', name, cwd: '/project', preview: '', updatedAt: 1 });
const createHost = () => new DirectoryJournal<ChatDirectoryEntry>({ epoch: 'host', stream: 'view',
  scope: directoryScope(query) });

function setup() {
  const host = createHost();
  host.commit([row('initial'), { key: '@page', kind: 'page', cursor: 'older', complete: false }]);
  const values = new Map<string, string>();
  const storage = { read: async (key: string) => values.get(key) ?? null,
    write: async (key: string, value: string) => { values.set(key, value); } };
  const calls: Record<string, unknown>[] = [];
  const request = async <T,>(body: object): Promise<T> => {
    const input = body as Record<string, unknown>; calls.push(input);
    return (input.checkpoint ? host.resume(input.checkpoint as ReturnType<typeof host.checkpoint>) : host.snapshot()) as T;
  };
  const apply = vi.fn();
  const failed = vi.fn();
  const client = () => {
    const value = new RemoteDirectory({ request, apply, failed });
    value.enabled = true; value.storage = storage; return value;
  };
  return { host, client, storage, values, calls, apply, failed };
}

it('persists data with the applied checkpoint, then reopens using only a lightweight resume', async () => {
  const test = setup();
  const first = test.client(); await first.read(query); await first.flush();
  expect(test.calls).toHaveLength(2);
  test.calls.length = 0;
  const reopened = test.client();
  const projected = await reopened.read(query);
  expect(projected.threads[0].name).toBe('initial');
  expect(projected.cursor).toBe('older');
  expect(test.calls).toHaveLength(1);
  expect(test.calls[0].checkpoint).toEqual(test.host.checkpoint());
});

it('detects truncated cache data and requests a bounded snapshot instead of resuming missing entities', async () => {
  const test = setup(); const first = test.client(); await first.read(query); await first.flush();
  const envelope = JSON.parse(test.values.get('codex')!) as { data: string };
  envelope.data = envelope.data.replace('initial', 'corrupted');
  test.values.set('codex', JSON.stringify(envelope)); test.calls.length = 0;
  await test.client().read(query);
  expect(test.calls[0]).not.toHaveProperty('checkpoint', expect.anything());
  expect(test.calls).toHaveLength(2);
});

it('applies snapshot-to-live overlap once and preserves structural sharing on duplicate events', async () => {
  const test = setup(); const client = test.client(); await client.read(query);
  const batch = test.host.commit([row('renamed')])!;
  client.receive(batch);
  const count = test.apply.mock.calls.length;
  client.receive(batch);
  expect(test.apply.mock.calls.length).toBe(count);
  expect(test.apply.mock.lastCall![1].threads[0].name).toBe('renamed');
});

it('does not publish a response from a disconnected account or device generation', async () => {
  let resolve!: (value: unknown) => void;
  const apply = vi.fn();
  const client = new RemoteDirectory({ request: async <T,>() => await new Promise<unknown>(done => { resolve = done; }) as T,
    apply, failed: vi.fn() });
  const pending = client.read(query);
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  client.disconnect();
  resolve(createHost().snapshot());
  await expect(pending).rejects.toThrow(CONNECTION_ERRORS.interrupted);
  expect(apply).not.toHaveBeenCalled();
});

it('does not start a network read when the account or device closes during cache restoration', async () => {
  let finish!: (value: string | null) => void;
  const request = vi.fn();
  const client = new RemoteDirectory({ request, apply: vi.fn(), failed: vi.fn() });
  client.storage = { read: () => new Promise(resolve => { finish = resolve; }), write: async () => {} };
  const pending = client.read(query);
  client.disconnect(); finish(null);
  await expect(pending).rejects.toThrow(CONNECTION_ERRORS.interrupted);
  expect(request).not.toHaveBeenCalled();
});

it('serializes writes even when the storage backend finishes asynchronously', async () => {
  let finish!: () => void;
  const calls: string[] = [];
  const writer = new DirectoryWriter({ read: async () => null, write: async (_key, value) => {
    calls.push(value); if (calls.length === 1) await new Promise<void>(resolve => { finish = resolve; });
  } }, vi.fn());
  writer.write('scope', { applied: 1 }); writer.write('scope', { applied: 2 }); writer.write('scope', { applied: 3 });
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  finish(); await writer.flush(); expect(calls).toHaveLength(2);
  expect(JSON.parse(JSON.parse(calls[1]).data)).toEqual({ applied: 3 });
});

it('bridges changes arriving before the initial snapshot response into one current state', async () => {
  const host = createHost();
  host.commit([row('before'), { key: '@page', kind: 'page', cursor: null, complete: true }]);
  const apply = vi.fn();
  let calls = 0;
  const client = new RemoteDirectory({ request: async <T,>(body: object) => {
    if (++calls === 1) {
      const snapshot = host.snapshot();
      client.receive(host.commit([row('during read')])!);
      return snapshot as T;
    }
    return host.resume((body as { checkpoint: ReturnType<typeof host.checkpoint> }).checkpoint) as T;
  }, apply, failed: vi.fn() });
  client.enabled = true;
  expect((await client.read(query)).threads[0].name).toBe('during read');
  expect(apply).toHaveBeenCalledOnce();
});

it('caches icon bytes across process exit and unchanged reconnect', async () => {
  const test = setup(); const source = 'data:image/png;base64,aGVsbG8=';
  const reference = directoryIconHash(source);
  test.host.commit([{ key: 'group:one', kind: 'group', id: 'one',
    value: { id: 'one', name: 'Group', parentId: null, icon: reference } }]);
  const iconCalls = vi.fn();
  const build = () => {
    const value = new RemoteDirectory({ request: async <T,>(body: object) => {
      const input = body as { action: string; checkpoint?: ReturnType<typeof test.host.checkpoint> };
      if (input.action === 'icon') { iconCalls(); return { source } as T; }
      return (input.checkpoint ? test.host.resume(input.checkpoint) : test.host.snapshot()) as T;
    }, apply: test.apply, failed: test.failed });
    value.storage = test.storage; return value;
  };
  const first = build(); await first.read(query); await first.flush();
  await build().read(query);
  expect(iconCalls).toHaveBeenCalledOnce();
  expect(test.apply.mock.lastCall![1].sidebar.grouping.groups[0].icon).toBe(source);
});
