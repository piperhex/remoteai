import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiffCache, DIFF_CACHE_LIMITS } from '../../../../../shared/chat/diffCache';
import type { Turn } from '../../../../../shared/conversation/types';

const patch = (path = 'src/a.ts', text = 'new') =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+${text}\n`;
const change = (diff = 'content\n', path = 'src/a.ts') => ({ path, diff, kind: { type: 'add' } });

beforeEach(() => vi.resetModules());

describe('diff content cache', () => {
  it('does not eagerly parse offscreen net diffs just to discover summary rows', async () => {
    const parser = await import('../../../../../shared/chat/diffParser');
    const parse = vi.spyOn(parser, 'parseUnifiedDiff');
    const { conversationEntries, completedTurnFiles } = await import('../../../../../shared/chat/turnPresentation');
    const turn: Turn = { id: 'history', status: 'completed', diff: patch(), items: [] };
    expect(conversationEntries([turn])).toEqual([{ id: 'history:summary', kind: 'summary', turn }]);
    expect(parse).not.toHaveBeenCalled();
    expect(completedTurnFiles(turn)).toHaveLength(1);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('reuses parsing and summaries for 100 text-only updates with fresh turns/items/changes', async () => {
    const parser = await import('../../../../../shared/chat/diffParser');
    const parse = vi.spyOn(parser, 'parseUnifiedDiff');
    const parseChange = vi.spyOn(parser, 'parseFileChange');
    const { completedTurnFiles } = await import('../../../../../shared/chat/turnPresentation');
    const { summarizeDiffFiles } = await import('../../../../../shared/chat/diffSummary');
    const body = Array.from({ length: 12000 }, (_, i) => `+const row_${i} = "${'payload '.repeat(6)}";`).join('\n');
    const diff = `diff --git a/src/large.ts b/src/large.ts\n--- a/src/large.ts\n+++ b/src/large.ts\n`
      + `@@ -0,0 +1,12000 @@\n${body}\n`;
    for (const mode of ['net', 'fileChanges']) {
      const beforeParse = parse.mock.calls.length;
      const beforeChange = parseChange.mock.calls.length;
      let first: ReturnType<typeof completedTurnFiles> | undefined;
      const startedAt = performance.now();
      for (let i = 0; i <= 100; i++) {
        const turn: Turn = { id: 'turn', status: 'inProgress', diff: mode === 'net' ? diff : '', items: [
          { id: 'edit', type: 'fileChange', status: 'completed', changes: [change(diff, 'src/large.ts')] },
          { id: 'text', type: 'agentMessage', text: `text delta ${i}` },
        ] };
        const files = completedTurnFiles(turn);
        first ??= files;
        expect(files).toBe(first);
        expect(summarizeDiffFiles(files)).toBe(summarizeDiffFiles(first));
      }
      const count = mode === 'net' ? parse.mock.calls.length - beforeParse
        : parseChange.mock.calls.length - beforeChange;
      expect(count).toBe(1);
      console.info(JSON.stringify({ mode, bytes: new TextEncoder().encode(diff).length, updates: 100,
        parses: count, elapsedMs: +(performance.now() - startedAt).toFixed(2) }));
    }
  });

  it('invalidates actual content/options, while preserving unchanged files and list order', async () => {
    const { changedFiles, parseDiff } = await import('../../../../../shared/conversation/diff');
    const first = changedFiles([change(), change('second', 'src/b.ts')]);
    expect(changedFiles([change(), change('second', 'src/b.ts')])).toBe(first);
    const updated = changedFiles([change(), change('third', 'src/b.ts')]);
    expect(updated[0]).toBe(first[0]);
    expect(updated[1]).not.toBe(first[1]);
    expect(changedFiles([change('second', 'src/b.ts'), change()]).map(file => file.path))
      .toEqual(['src/b.ts', 'src/a.ts']);
    expect(changedFiles([{ ...change(), kind: { type: 'delete' } }])[0].removed).toBe(1);
    expect(changedFiles([{ ...change(), kind: { type: 'update', movePath: 'moved.ts' } }])[0])
      .toMatchObject({ path: 'moved.ts', previousPath: 'src/a.ts', added: 0 });
    expect(changedFiles([change('content\n', 'other.ts')])[0].path).toBe('other.ts');
    expect(parseDiff(patch('src/a.ts', 'updated'))).not.toBe(parseDiff(patch()));
    expect(parseDiff(patch() + patch('src/b.ts'))).toHaveLength(2);
  });

  it('freezes arrays, files, lines, summaries, and does not mutate caller data', async () => {
    const { changedFiles, parseDiff } = await import('../../../../../shared/conversation/diff');
    const { summarizeDiffFiles } = await import('../../../../../shared/chat/diffSummary');
    for (const files of [parseDiff(patch()), changedFiles([change()])]) {
      const summary = summarizeDiffFiles(files);
      for (const value of [files, files[0], files[0].lines, files[0].lines[0], summary,
        summary.files, summary.files[0]]) expect(Object.isFrozen(value)).toBe(true);
      expect(() => Object.assign(files[0], { added: 999 })).toThrow();
    }
    const input = [change()];
    changedFiles(input);
    input[0].diff = 'updated\nextra\n';
    expect(changedFiles(input)[0].added).toBe(2);
  });

  it('handles empty/whitespace diffs, completed statuses and switching conversations without stale files', async () => {
    const { completedTurnFiles } = await import('../../../../../shared/chat/turnPresentation');
    const turn: Turn = { id: 'same-id', status: 'inProgress', items: [
      { id: 'edit', type: 'fileChange', status: 'inProgress', changes: [change()] },
    ] };
    expect(completedTurnFiles(turn)).toEqual([]);
    turn.items[0] = { ...turn.items[0], status: 'completed' };
    const completed = completedTurnFiles({ ...turn, diff: ' \r\n\t' });
    expect(completed).toHaveLength(1);
    for (const status of ['declined', 'failed', 'inProgress']) {
      expect(completedTurnFiles({ ...turn, items: [{ ...turn.items[0], status }] })).toEqual([]);
    }
    const other = completedTurnFiles({ ...turn, diff: patch('other.ts') });
    expect(other[0].path).toBe('other.ts');
    expect(completedTurnFiles({ ...turn, diff: '' })).toBe(completed);
    expect(completedTurnFiles({ ...turn, items: [] })).toEqual([]);
  });

  it('aggregates duplicate paths once without confusing files with the same basename', async () => {
    const { changedFiles } = await import('../../../../../shared/conversation/diff');
    const { summarizeDiffFiles } = await import('../../../../../shared/chat/diffSummary');
    const summary = summarizeDiffFiles(changedFiles([change(), change('again\n'), change('b\n', 'other/a.ts')]));
    expect(summary).toEqual({ files: [{ path: 'src/a.ts', added: 2, removed: 0 },
      { path: 'other/a.ts', added: 1, removed: 0 }], added: 3, removed: 0 });
  });

  it('evicts production entries and safely reparses an older conversation', async () => {
    const { parseDiff } = await import('../../../../../shared/conversation/diff');
    const original = parseDiff(patch());
    for (let i = 0; i < DIFF_CACHE_LIMITS.entries; i++) parseDiff(patch(`src/${i}.ts`));
    const reparsed = parseDiff(patch());
    expect(reparsed).not.toBe(original);
    expect(reparsed).toEqual(original);
  });

  it('bounds retained large source and parsed strings even below the entry limit', async () => {
    const { parseDiff } = await import('../../../../../shared/conversation/diff');
    const largeA = patch('a.ts', 'a'.repeat(1_500_000));
    const largeB = patch('b.ts', 'b'.repeat(1_500_000));
    const first = parseDiff(largeA);
    expect(parseDiff(largeA)).toBe(first);
    parseDiff(largeB);
    expect(parseDiff(largeA)).not.toBe(first);
    const oversized = patch('oversized.ts', 'c'.repeat(3_000_000));
    const hot = parseDiff(patch());
    expect(parseDiff(oversized)).toEqual(parseDiff(oversized));
    expect(parseDiff(oversized)).not.toBe(parseDiff(oversized));
    expect(parseDiff(patch())).toBe(hot);
  });

  it('enforces LRU entry and weighted bounds including source/option strings, and bypasses oversized values', () => {
    const cache = new DiffCache<number>({ entries: 2, weight: 24 });
    cache.set('a', 'x', 1, 4);
    cache.set('b', 'x', 2, 4);
    expect(cache.get('a', 'x')).toBe(1);
    cache.set('c', 'x', 3, 4);
    expect(cache.get('b', 'x')).toBeUndefined();
    cache.set('large-source', 'option', 4, 1);
    expect(cache.get('large-source', 'option')).toBeUndefined();
    expect(cache.get('a', 'x')).toBe(1);
    cache.set('d', 'x', 5, 17);
    expect(cache.get('a', 'x')).toBeUndefined();
    expect(cache.get('c', 'x')).toBeUndefined();
    expect(cache.get('d', 'x')).toBe(5);
    cache.set('d', 'x', 6, 30);
    expect(cache.get('d', 'x')).toBeUndefined();
  });
});
