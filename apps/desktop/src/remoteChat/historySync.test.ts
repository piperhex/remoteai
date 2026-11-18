import { expect, it, vi } from 'vitest';
import { applyHistoryDelta, contentHash, historyDelta, historyVersion } from '../../../../shared/remote-chat/historySync';
import { prepareBrowserHistoryDelta, createBrowserHistoryVersions } from '../../../../shared/remote-chat/browserHistory';
import { HistoryReader } from '../../../../shared/remote-chat/client/historyReader';
import type { Thread } from '../../../../shared/conversation/types';

const thread: Thread = { id: 'chat', preview: '', cwd: '', updatedAt: 1,
  turns: [{ id: 'turn', status: 'inProgress', items: [
    { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'already synchronized question' }] },
    { id: 'answer', type: 'agentMessage', text: 'already synchronized answer '.repeat(1000) },
  ] }] };

it('sends no message bodies on an unchanged poll or after a PC restart', () => {
  const delta = historyDelta(structuredClone(thread), historyVersion(thread));
  expect(delta.turns).toEqual([]);
  expect(JSON.stringify(delta)).not.toContain('already synchronized');
  expect(JSON.stringify(delta).length).toBeLessThan(200);
  expect(applyHistoryDelta(thread, delta)).toBe(thread);
});

it('sends only the unseen streaming suffix and completion metadata', () => {
  const next = structuredClone(thread);
  next.turns![0].status = 'completed';
  next.turns![0].items[1].text += 'new suffix';
  const delta = historyDelta(next, historyVersion(thread));
  expect(JSON.stringify(delta)).not.toContain('already synchronized');
  expect(delta.turns[0].items).toEqual([{ id: 'answer',
    patch: { set: {}, remove: [], append: { text: 'new suffix' } } }]);
  expect(applyHistoryDelta(thread, delta)).toEqual(next);
});

it('recovers missed turns, edits, deletions, reordering and removed fields', () => {
  const next = structuredClone(thread);
  next.name = 'renamed';
  next.turns![0].items = [{ id: 'answer', type: 'agentMessage', status: 'completed', text: 'edited' }];
  next.turns!.unshift({ id: 'missed', status: 'completed', items: [{ id: 'new', type: 'agentMessage', text: 'new' }] });
  expect(applyHistoryDelta(thread, historyDelta(next, historyVersion(thread)))).toEqual(next);
  const empty = { ...next, turns: [] };
  expect(applyHistoryDelta(next, historyDelta(empty, historyVersion(next)))).toEqual(empty);
});

it('does not append a suffix to a different prefix of the same length', () => {
  const next = structuredClone(thread);
  next.turns![0].items[1].text = 'different answer '.repeat(2000);
  expect(applyHistoryDelta(thread, historyDelta(next, historyVersion(thread)))).toEqual(next);
});

it('hashes only the known prefix of an append and skips hashing unseen fields', () => {
  const hash = vi.fn(contentHash);
  const next = structuredClone(thread);
  const original = next.turns![0].items[1].text!;
  const added = 'new suffix';
  next.turns![0].items[1].text = original + added;
  const delta = historyDelta(next, historyVersion(thread), hash);
  expect(hash).toHaveBeenCalledWith(original);
  expect(hash).not.toHaveBeenCalledWith(original + added);
  expect(delta.turns[0].items[0].patch.append.text).toBe(added);
  hash.mockClear();
  expect(applyHistoryDelta({ ...next, turns: [] }, historyDelta(next, undefined, hash))).toEqual(next);
  expect(hash).not.toHaveBeenCalled();
});

it('keeps inline originals separate from the history delta and reuses the same references on later reads', async () => {
  const source = 'data:image/png;base64,aGVsbG8=';
  const next: Thread = { ...thread, turns: [{ id: 'turn', status: 'completed', items: [
    { id: 'answer', type: 'agentMessage', text: `![Result](${source})` },
  ] }] };
  const empty = { ...next, turns: [] };
  const { delta, images } = await prepareBrowserHistoryDelta(next);
  const reference = `chat-image://${contentHash(source)}`;
  expect(images).toEqual([{ source, reference }]);
  expect(JSON.stringify(delta)).not.toContain(source);
  const read = applyHistoryDelta(empty, delta);
  expect(read.turns?.[0].items[0].text).toBe(`![Result](${reference})`);
  const known = await createBrowserHistoryVersions().read(read);
  expect(known).toEqual(historyVersion(read));
  const refreshed = await prepareBrowserHistoryDelta(structuredClone(next), known);
  expect(applyHistoryDelta(read, refreshed.delta)).toBe(read);
});

it('skips the request when the selected conversation changes during fingerprint preparation', async () => {
  let prepared!: (version: ReturnType<typeof historyVersion>) => void;
  let active = true;
  const request = vi.fn();
  const reader = new HistoryReader(request, { read: () => new Promise(resolve => { prepared = resolve; }) });
  const read = reader.read(thread, {}, () => active);
  active = false;
  prepared(historyVersion(thread));
  await expect(read).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
