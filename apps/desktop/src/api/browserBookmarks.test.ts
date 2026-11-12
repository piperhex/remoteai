import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookmarkChannel } from '../../../../shared/browser/bookmarks/channel';
import { BookmarkStore } from '../../../../shared/browser/bookmarks/store';
import { bookmarkUrl, mergeBookmarks, type Bookmark, type BookmarkDocument }
  from '../../../../shared/browser/bookmarks/model';

const entry = (id: string, title = id): Bookmark => ({ id, title, kind: 'link',
  url: `https://example.test/${id}`, parentId: '', position: 0 });
const memory = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};
const stops: (() => void)[] = [];
afterEach(() => { stops.splice(0).forEach(stop => stop()); vi.useRealTimers(); });

function server() {
  let document: BookmarkDocument = { revision: 0, entries: [] };
  const channels: BookmarkChannel[] = [];
  const connect = () => {
    const channel = new BookmarkChannel(frame => {
      queueMicrotask(() => {
        const edit = frame.bookmarks as BookmarkDocument | undefined;
        const accepted = !!edit && edit.revision === document.revision;
        if (accepted) document = { revision: document.revision + 1, entries: edit.entries };
        const reply = { type: 'bookmarks', id: frame.id, accepted, document };
        channel.receive(reply);
        if (accepted) channels.filter(item => item !== channel).forEach(item => item.receive(reply));
      });
      return true;
    });
    channels.push(channel); channel.ready(true); return channel;
  };
  return { connect, document: () => document };
}

describe('account bookmark synchronization', () => {
  it('pushes additions, folder edits and deletion to another device without polling', async () => {
    const cloud = server();
    const first = new BookmarkStore('alice', memory(), cloud.connect());
    const second = new BookmarkStore('alice', memory(), cloud.connect());
    stops.push(first.start(), second.start());
    await vi.waitFor(() => expect(first.snapshot().status).toBe('synced'));
    first.save(entry('guide'));
    await vi.waitFor(() => expect(second.snapshot().entries).toEqual([entry('guide')]));
    second.save({ ...entry('folder'), kind: 'folder', url: '' });
    second.save({ ...entry('guide', 'Guide updated'), parentId: 'folder' });
    await vi.waitFor(() => expect(first.snapshot().entries.find(item => item.id === 'guide')?.parentId).toBe('folder'));
    first.remove('folder');
    await vi.waitFor(() => expect(second.snapshot().entries).toEqual([]));
    expect(cloud.document().entries).toEqual([]);
  });

  it('merges concurrent additions and retains offline edits across restarts', async () => {
    const cloud = server(), storage = memory(), channel = cloud.connect();
    const offline = new BookmarkStore('alice', storage, channel);
    const stop = offline.start();
    await vi.waitFor(() => expect(offline.snapshot().status).toBe('synced'));
    channel.disconnect(); offline.save(entry('offline')); stop();
    channel.ready(true);
    const restored = new BookmarkStore('alice', storage, channel);
    const second = new BookmarkStore('alice', memory(), cloud.connect());
    second.save(entry('other-device'));
    stops.push(restored.start(), second.start());
    await vi.waitFor(() => expect(cloud.document().entries.map(item => item.id).sort()).toEqual(['offline', 'other-device']));
    await vi.waitFor(() => expect(restored.snapshot().entries).toEqual(second.snapshot().entries));
    expect(new BookmarkStore('bob', storage).snapshot().entries).toEqual([]);
  });

  it('keeps changes made while an earlier save is in flight', async () => {
    const cloud = server(), first = new BookmarkStore('alice', memory(), cloud.connect());
    stops.push(first.start());
    await vi.waitFor(() => expect(first.snapshot().status).toBe('synced'));
    first.save(entry('guide', 'First')); first.save(entry('guide', 'Latest'));
    await vi.waitFor(() => expect(cloud.document().entries[0]?.title).toBe('Latest'));
    expect(first.snapshot().entries[0].title).toBe('Latest');
  });

  it('pushes one complete reorder and preserves it after restart', async () => {
    const cloud = server(), storage = memory();
    const first = new BookmarkStore('alice', storage, cloud.connect());
    const second = new BookmarkStore('alice', memory(), cloud.connect());
    stops.push(first.start(), second.start());
    for (const [position, id] of ['a', 'b', 'c'].entries()) first.save({ ...entry(id), position });
    await vi.waitFor(() => expect(second.snapshot().entries.map(item => item.id)).toEqual(['a', 'b', 'c']));
    const revision = cloud.document().revision;
    first.reorder('a', 'c', true);
    await vi.waitFor(() => expect(second.snapshot().entries.map(item => item.id)).toEqual(['b', 'c', 'a']));
    expect(cloud.document().revision).toBe(revision + 1);
    expect(new BookmarkStore('alice', storage).snapshot().entries.map(item => item.id)).toEqual(['b', 'c', 'a']);
    second.reorder('a', 'b', false);
    await vi.waitFor(() => expect(first.snapshot().entries.map(item => item.id)).toEqual(['a', 'b', 'c']));
  });

  it('persists the bar setting and isolates it from another account', () => {
    const storage = memory(), store = new BookmarkStore('alice', storage);
    store.setShowBar(false); store.save(entry('guide'));
    expect(new BookmarkStore('alice', storage).snapshot()).toMatchObject({ showBar: false, entries: [entry('guide')] });
    expect(new BookmarkStore('bob', storage).snapshot()).toMatchObject({ showBar: true, entries: [] });
  });

  it('recovers children of concurrently deleted folders and rejects unsafe URLs', () => {
    expect(mergeBookmarks([{ ...entry('child'), parentId: 'folder' }], { folder: null })[0].parentId).toBe('');
    for (const url of ['javascript:alert(1)', 'file:///private.txt', 'https://user:secret@example.test']) {
      expect(bookmarkUrl(url)).toBeUndefined();
    }
  });
});
