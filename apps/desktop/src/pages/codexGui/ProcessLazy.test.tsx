// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProcessDetailsContext, type ProcessDetailsLoader } from '../../../../../shared/chat/DeferredProcessDetails';
import { summarizeProcesses } from '../../../../../shared/conversation/processDetails';
import { conversation } from '../../../../../shared/conversation/events';
import type { Item, Thread } from '../../../../../shared/conversation/types';
import { Messages } from './Messages';

vi.mock('../../../../../shared/conversation/RichText', () => ({
  RichText: ({ text }: { text: string }) => <p>{text}</p>,
}));
const items: Item[] = Array.from({ length: 2_000 }, (_, index) => ({ id: `work-${index}`,
  type: 'agentMessage', phase: 'commentary', text: `处理记录 ${index}` }));
const source: Thread = { id: 'chat', cwd: '', preview: '', updatedAt: 0,
  turns: [{ id: 'turn', status: 'completed', items: [{ id: 'question', type: 'userMessage',
    content: [{ type: 'text', text: '检查项目' }] }, ...items,
  { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: '全部完成' }] }] };
let container: HTMLDivElement;
let root: Root;
let load: ReturnType<typeof vi.fn<ProcessDetailsLoader>>;
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  load = vi.fn<ProcessDetailsLoader>().mockResolvedValue({ items });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});
const render = (active = true, thread = summarizeProcesses(source)) => act(async () => root.render(
  <ProcessDetailsContext.Provider value={{ load, active }}>
    <Messages selected={thread.id} value={conversation(thread)} active={active} />
  </ProcessDetailsContext.Provider>));
async function toggle(open: boolean) {
  await act(async () => {
    const details = container.querySelector('details')!;
    details.open = open; details.dispatchEvent(new Event('toggle'));
  });
}

it('never reads folded processes while scrolling and loads all 2000 rows only on expansion', async () => {
  await render();
  expect(container.querySelector('summary')?.getAttribute('aria-label')).toContain('2000');
  const viewport = container.querySelector('[aria-label="对话消息"]')!;
  await act(async () => {
    for (let index = 0; index < 5; index++) {
      viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }));
    }
  });
  expect(load).not.toHaveBeenCalled();
  expect(container.querySelectorAll('[data-message-id]')).toHaveLength(2);
  await toggle(true);
  expect(load).toHaveBeenCalledExactlyOnceWith({ threadId: 'chat', turnId: 'turn',
    itemId: 'work-0', endItemId: 'work-1999' });
  expect(container.textContent).toContain('处理记录 0');
  expect(container.textContent).toContain('处理记录 1999');
  expect(container.querySelectorAll('[data-message-id]')).toHaveLength(2_002);
  await toggle(false);
  expect(container.querySelectorAll('[data-message-id]')).toHaveLength(2);
  await render();
  expect(load).toHaveBeenCalledTimes(1);
});

it('retries a failed expansion and ignores the response after switching conversations', async () => {
  load.mockRejectedValueOnce(new Error('offline'));
  await render(); await toggle(true);
  const retry = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('重试'))!;
  expect(retry).toBeDefined();
  let finish!: (value: { items: Item[] }) => void;
  load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => retry.click());
  await render(true, { ...source, id: 'other', turns: [] });
  await act(async () => finish({ items }));
  expect(container.textContent).not.toContain('处理记录');
  expect(load).toHaveBeenCalledTimes(2);
});
