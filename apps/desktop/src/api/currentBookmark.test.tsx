// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { BookmarkProvider, useBookmarks } from '../../../../shared/browser/bookmarks/context';
import { useCurrentBookmark } from '../../../../shared/browser/bookmarks/useCurrentBookmark';

afterEach(() => vi.unstubAllGlobals());

it('saves a normalized current page once, preserves account storage, and rejects blank pages', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
  const container = document.createElement('div'); const root = createRoot(container);
  let current: ReturnType<typeof useCurrentBookmark>;
  let bookmarks: ReturnType<typeof useBookmarks>;
  let sequence = 0;
  function Page({ url }: { url: string }) {
    current = useCurrentBookmark({ url, title: '\u0000' + '😀'.repeat(250), newId: () => `saved-${++sequence}` });
    bookmarks = useBookmarks(); return null;
  }
  const render = async (url: string) => act(async () => root.render(
    <BookmarkProvider scope="quick-save" storage={storage}><Page url={url} /></BookmarkProvider>));
  try {
    await render('https://example.test');
    await act(async () => current.add()); await act(async () => current.add());
    expect(bookmarks!.entries).toHaveLength(1); expect(sequence).toBe(1);
    expect(bookmarks!.entries[0].url).toBe('https://example.test/');
    expect([...bookmarks!.entries[0].title].length).toBeLessThanOrEqual(200);
    expect(bookmarks!.entries[0].title).not.toContain('\u0000');
    expect(values.get('remoteai:browser-bookmarks:quick-save')).toContain('https://example.test/');
    await render('about:blank'); await act(async () => current.add());
    expect(current!.available).toBe(false); expect(bookmarks!.entries).toHaveLength(1);
  } finally { await act(async () => root.unmount()); }
});
