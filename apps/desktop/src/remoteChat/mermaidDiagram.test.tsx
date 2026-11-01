// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MermaidDiagram } from '../../../../shared/chat/MermaidDiagram';

const renderer = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string, source: string) => ({
    svg: `<svg id="${id}" xmlns="http://www.w3.org/2000/svg"><text>${source}</text></svg>`,
  })),
}));
vi.mock('mermaid', () => ({ default: renderer }));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  renderer.render.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});

const draw = (source: string, key = 'conversation') => act(async () => root.render(
  <MermaidDiagram key={key} source={source} previewLabel="Preview" sourceLabel="Source" copyLabel="Copy" />,
));
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

it('measures 40 committed source increments and a repeated diagram', async () => {
  let source = 'flowchart LR';
  for (let index = 0; index < 40; index++) {
    source += `\n N${index}[${index}]`;
    await draw(source); await advance(20);
  }
  await advance(250);
  expect(host.querySelector('.chat-mermaid-canvas svg')?.textContent).toBe(source);
  const incrementalLayouts = renderer.render.mock.calls.length;
  await act(async () => root.render(null));
  await draw(source, 'next-conversation'); await advance(250);
  const repeatedLayouts = renderer.render.mock.calls.length - incrementalLayouts;
  console.log('MERMAID_LAYOUT_COUNTS', JSON.stringify({ updates: 40, incrementalLayouts, repeatedLayouts }));
  if (!process.env.MERMAID_BASELINE) {
    expect(incrementalLayouts).toBe(1); expect(repeatedLayouts).toBe(0);
  }
});

it('does not render a pending input after unmount and shows the next conversation', async () => {
  await draw('flowchart LR\n Unmounted');
  await act(async () => root.render(null));
  await advance(250);
  if (!process.env.MERMAID_BASELINE) expect(renderer.render).not.toHaveBeenCalled();
  renderer.render.mockClear();
  await draw('flowchart LR\n Next', 'next'); await advance(250);
  expect(host.querySelector('.chat-mermaid-canvas svg')?.textContent).toContain('Next');
  expect(renderer.render).toHaveBeenCalledTimes(1);
});

it('never replaces final text with an outdated active layout or error', async () => {
  let resolve!: (result: { svg: string }) => void;
  renderer.render.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await draw('old active source'); await advance(250);
  await draw('latest final source'); await advance(250);
  expect(host.querySelector('code')?.textContent).toBe('latest final source');
  await act(async () => resolve({ svg: '<svg><text>old active source</text></svg>' }));
  expect(host.querySelector('.chat-mermaid-canvas svg')?.textContent).toBe('latest final source');
  renderer.render.mockRejectedValueOnce(new Error('incomplete'));
  await draw('incomplete terminal source'); await advance(250);
  expect(host.querySelector('.chat-mermaid-diagram')?.getAttribute('aria-busy')).toBe('false');
  expect(host.querySelector('code')?.textContent).toBe('incomplete terminal source');
  await draw('corrected source'); await advance(250);
  expect(host.querySelector('.chat-mermaid-canvas svg')?.textContent).toBe('corrected source');
});

it('does not publish a running result after unmount', async () => {
  let resolve!: (result: { svg: string }) => void;
  renderer.render.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await draw('unmounted active source'); await advance(250);
  await act(async () => root.render(null));
  await act(async () => resolve({ svg: '<svg><text>stale</text></svg>' }));
  expect(host.innerHTML).toBe('');
  expect(document.querySelector('[data-mermaid-render]')).toBeNull();
});

it('discards a running light layout when the document switches to dark', async () => {
  let resolve!: (result: { svg: string }) => void;
  renderer.render.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await draw('theme transition source'); await advance(250);
  await act(async () => { document.documentElement.dataset.theme = 'dark'; });
  await advance(250);
  await act(async () => resolve({ svg: '<svg><text>outdated light layout</text></svg>' }));
  expect(host.querySelector('.chat-mermaid-canvas svg')?.textContent).toBe('theme transition source');
  expect(renderer.initialize).toHaveBeenLastCalledWith(expect.objectContaining({
    themeVariables: expect.objectContaining({ darkMode: true }),
  }));
});
