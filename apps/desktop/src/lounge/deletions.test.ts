import { expect, it } from 'vitest';
import { LoungeDeletions, parseDeletionPage, parseDeletions } from '../../../../shared/lounge/deletions';
import type { LoungeMessage } from '../../../../shared/lounge/types';

it('merges deletion times monotonically and leaves group messages and later private messages visible', async () => {
  const deletions = new LoungeDeletions({ save: async () => {}, page: async () => ({ messages: [] }),
    deletions: async () => ({ bob: 1000 }) });
  await deletions.restore(); deletions.remember('bob', 900);
  expect(deletions.snapshot()).toEqual({ bob: 1000 });
  const old = { conversation: 'bob', sentAt: new Date(1000).toISOString() } as LoungeMessage;
  expect(deletions.accepts(old)).toBe(false);
  expect(deletions.accepts({ ...old, sentAt: new Date(1001).toISOString() })).toBe(true);
  expect(deletions.accepts({ ...old, conversation: undefined })).toBe(true);
  expect(deletions.accepts({ ...old, conversation: 'carol' })).toBe(true);
});

it('paginates tombstones independently of message history and rejects malformed sync input', () => {
  const deletions = new LoungeDeletions();
  for (let index = 0; index < 60; index++) deletions.remember(`peer-${String(index).padStart(2, '0')}`, index + 1);
  const first = parseDeletionPage(deletions.page());
  expect(Object.keys(first.entries)).toHaveLength(25);
  const second = parseDeletionPage(deletions.page(first.next));
  expect(Object.keys(second.entries)).toHaveLength(25);
  expect(Object.keys(deletions.page(second.next).entries)).toHaveLength(10);
  for (const value of [null, [], { bob: -1 }, { bob: 0 }, { bob: '1000' }, { bob: Infinity }]) {
    expect(() => parseDeletions(value)).toThrow();
  }
  expect(() => parseDeletionPage({ entries: { bob: 1000 }, next: 'carol' })).toThrow();
});
