// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConversationChangesButton } from '../../../../../shared/conversation/ConversationChangesButton';
import { DetailsContext, type DiffPanelEntry } from '../../../../../shared/conversation/detailsContext';
import { summarizeProcesses } from '../../../../../shared/conversation/processDetails';
import type { Item, Turn } from '../../../../../shared/conversation/types';

const edit: Item = { id: 'edit', type: 'fileChange', status: 'completed',
  changes: [{ path: 'new.ts', kind: { type: 'add' }, diff: 'export const latest = true;\n' }] };
const latest = (items: Item[] = [edit]): Turn => ({ id: 'latest', status: 'completed', items });
const diff = 'diff --git a/old.ts b/old.ts\n--- a/old.ts\n+++ b/old.ts\n@@ -1 +1 @@\n-old\n+new\n';
const old: Turn = { id: 'old', status: 'completed', items: [], diff };
const folded = (turns: Turn[]) => summarizeProcesses({
  id: 'thread', cwd: '', preview: '', updatedAt: 0, turns,
}).turns!;
const panel = { open: vi.fn(), update: vi.fn(), close: vi.fn(), visible: false, showingChanges: true,
  openFile: vi.fn(), openWebsite: vi.fn(), setConversationChanges: vi.fn<(entry: DiffPanelEntry) => void>() };
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function render(turns?: Turn[]) {
  await act(async () => root.render(<DetailsContext.Provider value={panel}>
    <ConversationChangesButton value={turns ? { turns } : undefined} />
  </DetailsContext.Provider>));
  return panel.setConversationChanges.mock.lastCall![0];
}

it.each([false, true])('selects the latest edits before and after folding, with older diff: %s', async (withOld) => {
  const turns = [...(withOld ? [old] : []), latest()];
  expect((await render(turns)).files.map(file => file.path)).toEqual(['new.ts']);
  const history = folded(turns);
  expect(history.at(-1)!.diff).toBeUndefined();
  expect(history.at(-1)!.items[0].type).toBe('processSummary');
  expect(history.at(-1)!.items[0].processOutputs).toEqual([edit]);
  const entry = await render(history);
  expect(entry.files.map(file => file.path)).toEqual(['new.ts']);
  await act(async () => host.querySelector('button')!.click());
  expect(panel.open).toHaveBeenLastCalledWith(entry);
  expect(panel.update).toHaveBeenLastCalledWith(entry);
});

it.each(['declined', 'failed', 'inProgress'])('skips %s edits at the top level and in folded outputs', async (status) => {
  const turn = latest([{ ...edit, status }]);
  for (const turns of [[turn], folded([turn])]) {
    expect((await render(turns)).files).toEqual([]);
    expect((await render([old, ...turns])).files.map(file => file.path)).toEqual(['old.ts']);
  }
});

it.each([
  { items: [] },
  { items: [{ ...edit, changes: [] }] },
  { items: [{ id: 'image', type: 'imageGeneration', status: 'completed' }] },
])(
  'skips turns without file changes: $items', async ({ items }) => {
    for (const turns of [[latest(items)], folded([latest(items)])]) {
      expect((await render(turns)).files).toEqual([]);
      expect((await render([old, ...turns])).files.map(file => file.path)).toEqual(['old.ts']);
    }
  },
);

it('skips whitespace diffs and clears files when switching to an empty conversation', async () => {
  expect((await render([old, { ...latest([]), diff: ' \r\n\t' }])).files[0].path).toBe('old.ts');
  expect((await render([])).files).toEqual([]);
  expect((await render()).files).toEqual([]);
});

it('prefers the net diff over folded edits and ignores their rejected status when a net diff exists', async () => {
  const turn = { ...latest([{ ...edit, status: 'declined' }]), diff };
  const entry = await render(folded([turn]));
  expect(entry.files).toEqual([expect.objectContaining({ path: 'old.ts', raw: diff })]);
});

it('keeps valid applied edits when mixed with invalid folded outputs', async () => {
  const items = ['declined', 'failed', 'inProgress'].map(status => ({ ...edit, id: status, status,
    changes: [{ path: `${status}.ts`, kind: { type: 'add' }, diff: 'ignored' }] }));
  const entry = await render(folded([old, latest([...items, edit])]));
  expect(entry.files.map(file => file.path)).toEqual(['new.ts']);
});

it('retains legacy edits without a status after folding', async () => {
  const entry = await render(folded([old, latest([{ ...edit, status: undefined }])]));
  expect(entry.files.map(file => file.path)).toEqual(['new.ts']);
});

it.each(['inProgress', 'interrupted', 'failed'])('retains applied edits in a %s turn', async (status) => {
  const entry = await render([old, { ...latest(), status }]);
  expect(entry.files.map(file => file.path)).toEqual(['new.ts']);
});
