import { beforeEach, expect, it, vi } from 'vitest';
import type { CatalogChange } from '../pages/codexGui/sidebarBridge';
import type { Thread } from '../../../../shared/conversation/types';
import type { SidebarSnapshot } from '../../../../shared/remote-chat/sidebar';
import type { DirectoryReply } from '../../../../shared/chat/directory/protocol';
import type { ChatDirectoryEntry } from '../../../../shared/chat/directory/documents';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mocks = vi.hoisted(() => ({ rows: new Map<string, { thread: Thread; archived: boolean }>(),
  sidebar: { revision: 0, threads: {}, readState: {}, grouping: { groups: [], projects: {}, threads: {} } } as SidebarSnapshot,
  lookup: vi.fn(), listeners: new Set<(change: CatalogChange) => void>(), read: vi.fn(), request: vi.fn() }));
vi.mock('../pages/codexGui/sidebarBridge', () => ({ guiSidebar: {
  catalogRow: (id: string) => { mocks.lookup(id); return mocks.rows.get(id); }, snapshot: () => mocks.sidebar, version: () => 0,
  subscribeCatalog: (fn: (change: CatalogChange) => void) => { mocks.listeners.add(fn); },
  observe: (threads: Thread[], _version: number, archived: boolean) => {
    threads.forEach(thread => mocks.rows.set(thread.id, { thread, archived }));
    mocks.listeners.forEach(fn => fn({ ids: new Set(threads.map(t => t.id)), live: false, global: false, grouping: false }));
  },
} }));
vi.mock('./threadList', () => ({ readRemoteThreadList: (...args: unknown[]) => mocks.read(...args) }));
vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { request: mocks.request } }));
import { ChatDirectory } from './directory';

const thread = (id: string, time = 1): Thread => ({ id, name: id, preview: '', cwd: '/project', updatedAt: time });
const query = { archived: false, search: '' };
const notify = (...ids: string[]) => {
  mocks.sidebar.revision++;
  mocks.listeners.forEach(fn => fn({ ids: new Set(ids), live: true, global: false, grouping: false }));
};
const reply = (value: unknown) => value as DirectoryReply<ChatDirectoryEntry>;

beforeEach(() => {
  mocks.listeners.clear(); mocks.rows.clear(); mocks.read.mockReset(); mocks.request.mockReset();
  mocks.sidebar = { revision: 0, threads: {}, readState: {}, grouping: { groups: [], projects: {}, threads: {} } };
});

it('keeps the first snapshot bounded despite a large warm host and never replays unchanged icon bytes', async () => {
  for (let index = 0; index < 1500; index++) mocks.rows.set(String(index), { thread: thread(String(index)), archived: false });
  mocks.sidebar.grouping!.groups.push({ id: 'group', name: 'Older', parentId: null,
    icon: 'data:image/png;base64,' + 'a'.repeat(10000) });
  mocks.read.mockResolvedValue({ data: [...mocks.rows.values()].slice(0, 50).map(row => row.thread), nextCursor: 'older' });
  const host = new ChatDirectory();
  const snapshot = reply(await host.request({ action: 'sync', query }));
  expect(snapshot.kind).toBe('snapshot');
  if (snapshot.kind !== 'snapshot') return;
  expect(snapshot.entries.filter(entry => entry.kind === 'thread')).toHaveLength(50);
  expect(JSON.stringify(snapshot)).not.toContain('data:image');
  const unchanged = await host.request({ action: 'sync', query, checkpoint: snapshot.checkpoint });
  expect(unchanged).toMatchObject({ kind: 'changes', upserts: [], removals: [] });
  expect(mocks.read).toHaveBeenCalledOnce();
  mocks.rows.set('0', { thread: { ...thread('0'), name: 'Renamed' }, archived: false }); notify('0');
  const delta = reply(await host.request({ action: 'sync', query, checkpoint: snapshot.checkpoint }));
  expect(delta).toMatchObject({ kind: 'changes', upserts: expect.arrayContaining([
    expect.objectContaining({ kind: 'thread', value: expect.objectContaining({ id: '0', name: 'Renamed' }) }),
  ]) });
  expect(JSON.stringify(delta)).not.toContain('data:image');
});

it('looks up only the changed summary across two large loaded views', async () => {
  const data = Array.from({ length: 1500 }, (_, index) => thread(String(index)));
  mocks.read.mockResolvedValue({ data, nextCursor: null });
  const host = new ChatDirectory();
  const first = reply(await host.request({ action: 'sync', query }));
  await host.request({ action: 'sync', query });
  if (first.kind !== 'snapshot') throw new Error('snapshot expected');
  mocks.lookup.mockClear();
  const unrelated = vi.fn(() => ({ title: 'unchanged', cwd: '/', projectName: '', running: false }));
  Object.defineProperty(mocks.sidebar.threads, '712', { get: unrelated });
  mocks.rows.get('700')!.thread = { ...data[700], name: 'renamed' };
  notify('700');
  expect(mocks.lookup.mock.calls).toEqual([['700']]);
  expect(unrelated).not.toHaveBeenCalled();
  const delta = reply(await host.request({ action: 'sync', query, checkpoint: first.checkpoint }));
  expect(delta.kind === 'changes' && delta.upserts.map(entry => entry.key)).toEqual(['thread:700', '@metadata']);
});

it('replays offline deletion and archival separately without removing unrelated cached entities', async () => {
  mocks.read.mockResolvedValue({ data: [thread('one'), thread('two'), thread('three')], nextCursor: null });
  const host = new ChatDirectory();
  const snapshot = reply(await host.request({ action: 'sync', query }));
  if (snapshot.kind !== 'snapshot') throw new Error('snapshot expected');
  mocks.rows.delete('one'); mocks.rows.get('two')!.archived = true; notify('one', 'two');
  const result = await host.request({ action: 'sync', query, checkpoint: snapshot.checkpoint });
  expect(result).toMatchObject({ kind: 'changes', removals: [
    { key: 'thread:one', reason: 'deleted' }, { key: 'thread:two', reason: 'outOfScope' },
  ] });
});

it('does not let a slow initial snapshot resurrect an entity deleted during the read', async () => {
  mocks.rows.set('one', { thread: thread('one'), archived: false });
  let resolve!: (page: { data: Thread[]; nextCursor: null }) => void;
  mocks.read.mockReturnValue(new Promise(done => { resolve = done; }));
  const host = new ChatDirectory(); notify('one');
  const pending = host.request({ action: 'sync', query });
  mocks.rows.delete('one'); notify('one');
  resolve({ data: [thread('one')], nextCursor: null });
  const snapshot = reply(await pending);
  expect(snapshot.kind === 'snapshot' && snapshot.entries.filter(entry => entry.kind === 'thread')).toEqual([]);
});

it('measures serialized directory traffic with synthetic catalogs and two remote views', async () => {
  const measures: object[] = [];
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  for (const size of [100, 1500]) {
    mocks.rows.clear(); mocks.listeners.clear();
    const rows = Array.from({ length: size }, (_, index) => thread(String(index).padStart(5, '0'), size - index));
    mocks.sidebar = { revision: 1, readState: {}, pins: [], pinnedProjects: [],
      threads: Object.fromEntries(rows.map(row => [row.id, { title: row.name!, cwd: row.cwd,
        projectName: 'Synthetic project', running: false }])), grouping: { projects: {},
      threads: Object.fromEntries(rows.slice(50).map(row => [row.id, 'older'])),
      groups: [{ id: 'older', name: 'Synthetic older group', parentId: null,
        icon: 'data:image/png;base64,' + 'a'.repeat(16000) }] } };
    rows.forEach(row => mocks.rows.set(row.id, { thread: row, archived: false }));
    mocks.read.mockImplementation(async (body: { cursor?: string }) => ({
      data: rows.slice(body.cursor ? 50 : 0, body.cursor ? 100 : 50), nextCursor: body.cursor ? null : 'older',
    }));
    const host = new ChatDirectory();
    const events: unknown[] = [];
    const first = reply(await host.request({ action: 'sync', query }));
    const second = reply(await host.request({ action: 'sync', query }));
    if (first.kind !== 'snapshot' || second.kind !== 'snapshot') throw new Error('snapshot expected');
    host.subscribe(event => { if (event.params.checkpoint.stream === first.checkpoint.stream) events.push(event); });
    const tail = await host.request({ action: 'sync', query, checkpoint: first.checkpoint });
    const group = first.entries.find(entry => entry.kind === 'group');
    const icon = await host.request({ action: 'icon', reference: group?.kind === 'group' ? group.value.icon : '' });
    measures.push({ size, operation: 'initial', legacyBytes: bytes({ data: rows, nextCursor: 'older', sidebar: mocks.sidebar }),
      newBytes: bytes(first) + bytes(tail) + bytes(icon), newDirectoryBytes: bytes(first) + bytes(tail),
      newIconBytes: bytes(icon), legacySummaries: rows.length, newSummaries: 50, newRequests: 3 });
    for (const operation of ['rename', 'running', 'read'] as const) {
      events.length = 0;
      const id = rows[0].id;
      if (operation === 'rename') {
        mocks.rows.get(id)!.thread = { ...rows[0], name: 'Synthetic rename' };
        mocks.sidebar.threads[id] = { ...mocks.sidebar.threads[id], title: 'Synthetic rename' };
      } else if (operation === 'running') mocks.sidebar.threads[id] = { ...mocks.sidebar.threads[id], running: true };
      else mocks.sidebar.readState[id] = { turnId: 'synthetic-turn', unread: false };
      notify(id);
      measures.push({ size, operation, legacyBytes: bytes({ method: 'chat/sidebar/updated', params: mocks.sidebar }),
        newBytes: events.reduce<number>((total, event) => total + bytes(event), 0),
        legacyEvents: 1, newEvents: events.length });
    }
    const checkpoint = (await host.request({ action: 'sync', query, checkpoint: first.checkpoint }) as
      { checkpoint: typeof first.checkpoint }).checkpoint;
    const started = performance.now();
    const resumed = await host.request({ action: 'sync', query, checkpoint });
    measures.push({ size, operation: 'unchangedResume', legacyBytes: bytes({ data: rows, sidebar: mocks.sidebar }),
      newBytes: bytes(resumed), newRequests: 1, newEvents: 0, newSummaries: 0,
      hostMilliseconds: Number((performance.now() - started).toFixed(3)), reset: false });
    events.length = 0;
    const page = reply(await host.request({ action: 'page', query, checkpoint }));
    expect(events).toHaveLength(0);
    measures.push({ size, operation: 'page', legacyBytes: bytes({ data: rows.slice(50, 100), sidebar: mocks.sidebar }),
      newBytes: bytes(page), newSummaries: page.kind === 'changes' ? page.upserts.filter(e => e.kind === 'thread').length : -1 });
  }
  const output = resolve('../../.codex-tmp/directory-sync');
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, 'traffic.json'), JSON.stringify({ layer: 'uncompressed application JSON; synthetic data',
    measurements: measures }, null, 2));
  console.log('DIRECTORY_TRAFFIC', JSON.stringify(measures));
  const changes = measures as { operation: string; size: number; newBytes: number }[];
  for (const operation of ['rename', 'running', 'read', 'unchangedResume']) {
    const rows = changes.filter(row => row.operation === operation);
    expect(Math.abs(rows[0].newBytes - rows[1].newBytes)).toBeLessThan(32);
  }
});
