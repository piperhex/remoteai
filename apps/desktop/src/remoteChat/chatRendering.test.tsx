// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatMessages } from '../../../../shared/remote-chat/views/ChatMessages';
import { ChatMarkdown } from '../../../../shared/remote-chat/views/ChatMarkdown';
import type { Item, Thread, Turn } from '../../../../shared/remote-chat/client/types';

const counts = vi.hoisted(() => ({ rows: [] as string[], markdown: [] as string[] }));
vi.mock('../../../../shared/remote-chat/client/asyncQuestions', async original => {
  const actual = await original<typeof import('../../../../shared/remote-chat/client/asyncQuestions')>();
  return { ...actual, questionMessageText: (item: Item) => {
    counts.rows.push(item.id); return actual.questionMessageText(item);
  } };
});
vi.mock('react-markdown', async original => {
  const actual = await original<typeof import('react-markdown')>();
  return { ...actual, default: (props: Parameters<typeof actual.default>[0]) => {
    counts.markdown.push(props.children ?? ''); return actual.default(props);
  } };
});

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  // Count memoized renders independently of asynchronous viewport admission; browser tests cover windowing.
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  counts.rows = []; counts.markdown = [];
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it('measures historical rows and real Markdown parses with fixed streamed input', async () => {
  const history: Turn[] = Array.from({ length: 120 }, (_, index) => ({
    id: `old-${index}`, status: 'completed', items: [
      { id: `history-${index}`, type: 'agentMessage', text: `History ${index}: **answer** with $x^2$.` },
    ],
  }));
  let text = 'Live: ';
  const render = async () => {
    const thread: Thread = { id: 'thread', cwd: '', preview: '', updatedAt: 1,
      turns: [...history, { id: 'live', status: 'inProgress', items: [
        { id: 'active', type: 'agentMessage', text },
      ] }] };
    await act(async () => root.render(<ChatMessages thread={thread} />));
  };
  await render(); counts.rows = []; counts.markdown = [];
  for (let index = 0; index < 40; index++) { text += `chunk-${index} `; await render(); }
  const measured = { historyRows: counts.rows.filter(id => id.startsWith('history-')).length,
    historyParses: counts.markdown.filter(value => value.startsWith('History ')).length,
    activeRows: counts.rows.filter(id => id === 'active').length,
    activeParses: counts.markdown.filter(value => value.startsWith('Live: ')).length };
  process.stdout.write(`CHAT_RENDER_COUNTS ${JSON.stringify(measured)}\n`);
  expect(host.querySelector('[data-message-id="active"]')?.textContent).toContain(text.trim());
  expect(measured.activeRows).toBe(40);
  if (!process.env.CHAT_RENDER_BASELINE) {
    expect(measured.historyRows).toBe(0); expect(measured.historyParses).toBe(0);
  } else {
    expect(measured.historyRows).toBe(4800); expect(measured.historyParses).toBe(4800);
  }
});

it('does not reparse unchanged content for presentation-only changes', async () => {
  await act(async () => root.render(<ChatMarkdown text="**Preserved** $x^2$" />));
  counts.markdown = [];
  await act(async () => root.render(<ChatMarkdown text="**Preserved** $x^2$" process />));
  if (!process.env.CHAT_RENDER_BASELINE) expect(counts.markdown).toHaveLength(0);
  expect(host.querySelector('strong')?.textContent).toBe('Preserved');
  expect(host.querySelector('.katex')).not.toBeNull();
});
