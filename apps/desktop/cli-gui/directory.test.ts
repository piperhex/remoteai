import { expect, it, vi } from 'vitest';
import type { PaseoAgent, PaseoAgentUpdate, PaseoClient } from '@getpaseo/client';
import { CliDirectory } from './directory';
import { CliListDirectory } from '../../../shared/cli-gui/directory';
import { coalesceCliChanges } from '../../../shared/cli-gui/changes';
import type { CliChange, CliRequest, CliSession, CliTransport } from '../../../shared/cli-gui/types';

const session = (id: string, engine: 'claude' | 'gemini' = 'claude'): CliSession => ({
  id, engine, title: `Test ${id}`, cwd: '/fixture', status: 'idle', updatedAt: '2026-11-17T00:00:00Z',
  archived: false, permissions: [], model: 'test',
});

function fixture() {
  const rows = Array.from({ length: 1200 }, (_, index) => session(String(index).padStart(4, '0'),
    index % 2 ? 'gemini' : 'claude'));
  let receive: (event: PaseoAgentUpdate) => void = () => {};
  const changed = vi.fn<(event: CliChange) => void>();
  const host = new CliDirectory({ session: async agent => rows.find(row => row.id === agent.id)!, changed });
  const client = { agents: {
    subscribe: (listener: typeof receive) => { receive = listener; return () => {}; },
    list: vi.fn(async ({ page: { cursor, limit } }: { page: { cursor?: string; limit: number } }) => {
      const offset = Number(cursor ?? 0);
      return { entries: rows.slice(offset, offset + limit).map(row => ({ agent: { id: row.id, provider: row.engine,
        archivedAt: row.archived ? row.updatedAt : null, labels: { remoteai: 'cli-gui' } } as unknown as PaseoAgent })),
      pageInfo: { nextCursor: offset + limit < rows.length ? String(offset + limit) : null } };
    }),
  } } as unknown as PaseoClient;
  return { rows, host, client, changed, receive: (value: PaseoAgentUpdate) => receive(value) };
}

it('returns bounded engine pages and replays only the changed engine with empty unchanged resume', async () => {
  const test = fixture();
  const snapshot = await test.host.request(test.client, { engine: 'claude', action: 'syncList', archived: false });
  if (snapshot.kind !== 'snapshot') throw new Error('snapshot expected');
  expect(snapshot.entries.filter(entry => entry.kind === 'session')).toHaveLength(50);
  expect(snapshot.entries.filter(entry => entry.kind === 'session').every(entry => entry.value.engine === 'claude')).toBe(true);
  const calls = vi.mocked(test.client.agents.list).mock.calls.length;
  expect(await test.host.request(test.client, { engine: 'claude', action: 'syncList', archived: false,
    checkpoint: snapshot.checkpoint })).toMatchObject({ kind: 'changes', upserts: [], removals: [] });
  expect(vi.mocked(test.client.agents.list).mock.calls).toHaveLength(calls);
  test.host.observe({ ...test.rows[0], title: 'Renamed' });
  const delta = await test.host.request(test.client, { engine: 'claude', action: 'syncList', archived: false,
    checkpoint: snapshot.checkpoint });
  expect(delta).toMatchObject({ kind: 'changes', upserts: [{ key: 'claude:0000', value: { title: 'Renamed' } }] });
  expect(test.changed.mock.lastCall![0].engine).toBe('claude');
  const next = await test.host.request(test.client, { engine: 'claude', action: 'syncList', archived: false,
    checkpoint: snapshot.checkpoint, more: true });
  expect(next.kind === 'changes' && next.upserts.filter(entry => entry.kind === 'session')).toHaveLength(51);
  test.host.close();
});

it('carries externally observed removal and archive transitions in the directory log', async () => {
  const test = fixture();
  const snapshot = await test.host.request(test.client, { engine: 'claude', action: 'syncList', archived: false });
  if (snapshot.kind !== 'snapshot') throw new Error('snapshot expected');
  test.host.observe({ ...test.rows[0], archived: true });
  test.receive({ kind: 'remove', agentId: test.rows[2].id });
  const delta = await test.host.request(test.client, { engine: 'claude', action: 'syncList', archived: false,
    checkpoint: snapshot.checkpoint });
  expect(delta).toMatchObject({ kind: 'changes', removals: [
    { key: 'claude:0000', reason: 'outOfScope' }, { key: 'claude:0002', reason: 'deleted' },
  ] });
  test.host.close();
});

it('clients deduplicate coalesced events and page responses while retaining older rows', async () => {
  const test = fixture();
  const apply = vi.fn();
  const transport: CliTransport = { subscribe: () => () => {}, request: async <T,>(request: CliRequest) => {
    if (request.action !== 'syncList') throw new Error('unexpected operation');
    return await test.host.request(test.client, request) as T;
  } };
  const client = new CliListDirectory({ transport, apply, failed: error => { throw error; } });
  const query = { engine: 'claude' as const, archived: false, search: '' };
  await client.read(query);
  test.changed.mockClear();
  test.host.observe({ ...test.rows[0], title: 'first' });
  test.host.observe({ ...test.rows[0], title: 'final' });
  const events = coalesceCliChanges(test.changed.mock.calls.map(([change]) => change));
  expect(events).toHaveLength(1);
  client.receive(events[0]);
  const count = apply.mock.calls.length;
  client.receive(events[0]);
  expect(apply.mock.calls).toHaveLength(count);
  await client.read(query, true);
  expect(apply.mock.lastCall![1]).toHaveLength(100);
  expect(apply.mock.lastCall![1].find((row: CliSession) => row.id === '0000')?.title).toBe('final');
  test.host.close();
});
