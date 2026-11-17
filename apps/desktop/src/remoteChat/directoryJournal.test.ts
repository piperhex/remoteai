import { expect, it } from 'vitest';
import { DirectoryJournal } from '../../../../shared/chat/directory/journal';
import { DirectoryReplica } from '../../../../shared/chat/directory/replica';
import { threadSummary } from '../../../../shared/chat/directory/summary';

const journal = (options = {}) => new DirectoryJournal<{ key: string; title: string }>({
  epoch: 'host-incarnation', stream: 'view', scope: 'active', ...options });

it('replays coalesced upserts, deletions and scope exits, with constant-size unchanged acknowledgement', () => {
  const host = journal();
  host.commit([{ key: 'one', title: 'before' }, { key: 'gone', title: 'delete me' }]);
  const replica = new DirectoryReplica<{ key: string; title: string }>();
  replica.apply(host.snapshot());
  const checkpoint = replica.snapshot!.checkpoint;
  host.commit([{ key: 'one', title: 'intermediate' }]);
  host.commit([{ key: 'one', title: 'after' }, { key: 'new', title: 'created offline' }],
    [{ key: 'gone', reason: 'deleted' }]);
  const replay = host.resume(checkpoint);
  expect(replay).toMatchObject({ kind: 'changes', from: checkpoint.revision,
    upserts: [{ key: 'one', title: 'after' }, { key: 'new', title: 'created offline' }],
    removals: [{ key: 'gone', reason: 'deleted' }] });
  expect(replica.apply(replay)).toBe('applied');
  expect(replica.apply(replay)).toBe('duplicate');
  const settled = replica.snapshot;
  expect(replica.apply(host.resume(settled!.checkpoint))).toBe('duplicate');
  expect(replica.snapshot).toBe(settled);
});

it('explicitly resets incompatible, future, expired and rebuilt checkpoints without a reset loop', () => {
  const host = journal({ maxEntries: 1 });
  const initial = host.checkpoint();
  host.commit([{ key: 'one', title: '1' }]); host.commit([{ key: 'one', title: '2' }]);
  for (const checkpoint of [initial, { ...host.checkpoint(), schema: 2 }, { ...host.checkpoint(), epoch: 'old' },
    { ...host.checkpoint(), revision: 100 }, { ...host.checkpoint(), scope: 'archived' }]) {
    expect(host.resume(checkpoint)).toEqual({ kind: 'resetRequired' });
  }
  expect(host.resume(host.snapshot().checkpoint)).toMatchObject({ kind: 'changes', upserts: [], removals: [] });
});

it('preserves the applied checkpoint on missing coverage and ignores a late snapshot', () => {
  const host = journal();
  host.commit([{ key: 'one', title: 'before' }]);
  const snapshot = host.snapshot();
  const replica = new DirectoryReplica<{ key: string; title: string }>();
  replica.apply(snapshot);
  host.commit([{ key: 'one', title: 'during snapshot' }]);
  const last = host.commit([{ key: 'one', title: 'during replay' }])!;
  expect(replica.apply(last)).toBe('resetRequired');
  expect(replica.snapshot).toBe(snapshot);
  expect(replica.apply(host.resume(snapshot.checkpoint))).toBe('applied');
  expect(replica.apply(snapshot)).toBe('duplicate');
  expect(replica.snapshot!.entries[0].title).toBe('during replay');
});

it('uses covered intervals rather than demanding an event for every global sequence', () => {
  const host = journal();
  host.commit([{ key: 'one', title: 'before' }]);
  const replica = new DirectoryReplica<{ key: string; title: string }>();
  replica.apply(host.snapshot());
  expect(replica.apply({ kind: 'changes', from: 1, checkpoint: { ...host.checkpoint(), revision: 40 },
    upserts: [{ key: 'one', title: 'latest matching change' }], removals: [] })).toBe('applied');
  expect(replica.snapshot!.checkpoint.revision).toBe(40);
});

it('bounds logs by serialized bytes and allowlists summary fields', () => {
  const host = journal({ maxBytes: 200 });
  const before = host.checkpoint();
  host.commit([{ key: 'one', title: 'x'.repeat(1000) }]);
  expect(host.resume(before).kind).toBe('resetRequired');
  const summary = threadSummary({ id: 'one', cwd: '/project', preview: 'a'.repeat(1000), updatedAt: 1,
    turns: [{ id: 'turn', status: 'completed', items: [] }], tokenUsage: {
      total: { totalTokens: 1 }, last: { totalTokens: 1 } } });
  expect(summary.preview).toHaveLength(240);
  expect(summary).not.toHaveProperty('turns'); expect(summary).not.toHaveProperty('tokenUsage');
});
