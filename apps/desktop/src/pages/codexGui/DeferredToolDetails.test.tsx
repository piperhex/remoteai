// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ToolDetailsContext, type ToolDetailsLoader } from '../../../../../shared/chat/DeferredToolDetails';
import { ActivityRow } from './ActivityRow';
import { ChatActivity } from '../../../../../shared/remote-chat/views/ChatActivity';
import type { Item } from '../../../../../shared/conversation/types';

let root: Root;
let container: HTMLDivElement;
const summary: Item = { id: 'command', type: 'commandExecution', status: 'inProgress', commandPreview: 'npm test',
  detailsRef: { threadId: 'chat', turnId: 'turn', itemId: 'command' } };
const full: Item = { id: 'command', type: 'commandExecution', command: 'npm test --all', aggregatedOutput: 'PASS: payload' };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});
async function render(load: ToolDetailsLoader, mode = 'local', item = summary, active = true) {
  await act(async () => root.render(<ToolDetailsContext.Provider value={{ load, active }}>
    {mode === 'local' ? <ActivityRow item={item} text="" /> : <ChatActivity item={item} inline onOpen={() => {}} />}
  </ToolDetailsContext.Provider>));
}
async function toggle(mode: string, open = true) {
  await act(async () => {
    if (mode !== 'local') { container.querySelector('button')!.click(); return; }
    const node = container.querySelector('details')!;
    node.open = open; node.dispatchEvent(new Event('toggle'));
  });
}

it.each(['local', 'remote', 'web'])('%s requests only an opened item, refreshes while open, and releases on collapse', async mode => {
  const load = vi.fn(async () => ({ item: full }));
  await render(load, mode);
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(load).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('PASS: payload');
  await toggle(mode);
  expect(load).toHaveBeenCalledExactlyOnceWith(summary.detailsRef);
  expect(container.textContent).toContain('PASS: payload');
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(load).toHaveBeenCalledTimes(2);
  await toggle(mode, false);
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(load).toHaveBeenCalledTimes(2);
  expect(container.textContent).not.toContain('PASS: payload');
});

it('serializes refreshes across completion and reloads the final result without keeping a timer', async () => {
  let resolve!: (value: { item: Item }) => void;
  const load = vi.fn(() => new Promise<{ item: Item }>(done => { resolve = done; }));
  await render(load); await toggle('local');
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(load).toHaveBeenCalledTimes(1);
  await render(load, 'local', { ...summary, status: 'completed' });
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ item: full }));
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => resolve({ item: { ...full, aggregatedOutput: 'FINAL' } }));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(load).toHaveBeenCalledTimes(2); expect(container.textContent).toContain('FINAL');
});

it('supports retry and suspends refreshes when the conversation is hidden', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ item: full });
  await render(load); await toggle('local');
  expect(container.querySelector('[role="status"] button')).not.toBeNull();
  await act(async () => (container.querySelector('[role="status"] button') as HTMLButtonElement).click());
  expect(container.textContent).toContain('PASS: payload');
  await render(load, 'local', summary, false);
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(load).toHaveBeenCalledTimes(2);
  await render(load, 'local', summary, true);
  expect(load).toHaveBeenCalledTimes(3);
});

it('discards an old conversation response after switching to another item', async () => {
  let resolve!: (value: { item: Item }) => void;
  const load = vi.fn().mockImplementationOnce(() => new Promise<{ item: Item }>(done => { resolve = done; }))
    .mockResolvedValue({ item: { ...full, aggregatedOutput: 'NEW CONVERSATION' } });
  await render(load); await toggle('local');
  await render(load, 'local', { ...summary, detailsRef: { ...summary.detailsRef!, threadId: 'other' } });
  expect(container.textContent).toContain('NEW CONVERSATION');
  await act(async () => resolve({ item: full }));
  expect(container.textContent).not.toContain('PASS: payload');
  expect(container.textContent).toContain('NEW CONVERSATION');
});
