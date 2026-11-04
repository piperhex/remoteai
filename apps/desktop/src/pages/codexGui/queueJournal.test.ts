import { expect, it, vi } from 'vitest';
import { QueueJournal, type QueueSnapshot, type QueueStorage } from './queueJournal';
import type { QueuedMessage } from '../../../../../shared/conversation/types';

const message: QueuedMessage = { id: 'one', text: 'next task', images: [], skills: [],
  model: 'model', effort: 'high', access: 'read-only' };
function storage() {
  let disk: QueueSnapshot = { revision: 0, threads: {} };
  const store: QueueStorage = {
    read: async () => structuredClone(disk),
    save: vi.fn(async snapshot => {
      if (snapshot.revision !== disk.revision) throw new Error('conflict');
      disk = structuredClone({ ...snapshot, revision: disk.revision + 1 });
      return disk;
    }),
  };
  return store;
}

it('restores waiting messages, but never automatically redispatches an interrupted send', async () => {
  const store = storage();
  const journal = new QueueJournal(store, vi.fn(), vi.fn());
  await journal.restore();
  journal.remember({ thread: [message, { ...message, id: 'sending', busy: true }] });
  await journal.saved();
  const restore = vi.fn();
  await new QueueJournal(store, restore, vi.fn()).restore();
  expect(restore).toHaveBeenCalledWith({ thread: [message, expect.objectContaining({
    id: 'sending', busy: false, needsReview: true,
  })] });
});

it('does not acknowledge a message while its save is pending or has failed', async () => {
  const store = storage();
  let reject!: (error: Error) => void;
  store.save = vi.fn(() => new Promise<QueueSnapshot>((_resolve, failed) => { reject = failed; }));
  const failed = vi.fn(); const accepted = vi.fn();
  const journal = new QueueJournal(store, vi.fn(), failed);
  await journal.restore();
  journal.remember({ thread: [message] });
  const pending = journal.saved().then(accepted);
  const rejected = expect(pending).rejects.toThrow('disk full');
  await Promise.resolve(); expect(accepted).not.toHaveBeenCalled();
  reject(new Error('disk full')); await rejected;
  expect(failed).toHaveBeenCalledOnce();
});

it('serializes writes and retains the latest edit across reopening', async () => {
  const store = storage();
  const journal = new QueueJournal(store, vi.fn(), vi.fn()); await journal.restore();
  journal.remember({ thread: [message] });
  journal.remember({ thread: [{ ...message, text: 'edited' }] });
  await journal.saved();
  expect(await store.read()).toEqual({ revision: 2, threads: { thread: [{ ...message, text: 'edited' }] } });
});
