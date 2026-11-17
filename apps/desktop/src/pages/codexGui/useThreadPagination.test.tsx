// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useViewportThreadPagination } from '../../../../../shared/remote-chat/client/useViewportThreadPagination';

let root: Root;
let container: HTMLDivElement;
let viewport: number;
let content: number;
let cursor: string | null;
let ready: boolean;
let requireGesture: boolean;
let resize: () => void;
let disconnect: ReturnType<typeof vi.fn>;
const loadMore = vi.fn<() => Promise<void>>();

function Harness() {
  const pagination = useViewportThreadPagination({ enabled: ready, loading: false,
    cursor, scope: 'recent', loadMore, requireGesture });
  return <div ref={pagination.list} data-list>
    {pagination.failed && <button onClick={pagination.retry}>重试</button>}
  </div>;
}
const render = () => act(async () => root.render(<Harness />));
const list = () => container.querySelector<HTMLDivElement>('[data-list]')!;
const scroll = (top: number) => act(async () => {
  list().scrollTop = top;
  list().dispatchEvent(new Event('scroll'));
});

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  viewport = 400; content = 400; cursor = 'first'; ready = true;
  requireGesture = false;
  disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => viewport);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => content);
  loadMore.mockReset();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});

it('keeps folded directory previews bounded until each deliberate paging gesture', async () => {
  requireGesture = true;
  loadMore.mockImplementation(async () => { cursor += '-next'; root.render(<Harness />); });
  await render();
  await act(async () => { resize(); resize(); });
  expect(loadMore).not.toHaveBeenCalled();
  await act(async () => list().dispatchEvent(new WheelEvent('wheel', { deltaY: 100 })));
  expect(loadMore).toHaveBeenCalledTimes(1);
  await render(); await act(async () => resize());
  expect(loadMore).toHaveBeenCalledTimes(1);
  await act(async () => list().dispatchEvent(new WheelEvent('wheel', { deltaY: 100 })));
  expect(loadMore).toHaveBeenCalledTimes(2);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it.each([400, 800])('preloads one screen and refills after 70% of that screen at height %i', async height => {
  viewport = height; content = height;
  loadMore.mockImplementation(async () => {
    content += viewport;
    cursor = String(Number(cursor) + 1);
    root.render(<Harness />);
  });
  cursor = '0';
  await render();
  expect(loadMore).toHaveBeenCalledTimes(1);
  expect(content).toBe(viewport * 2);
  for (let screen = 0; screen < 3; screen++) {
    await scroll(viewport * (screen + 0.7) - 1);
    expect(loadMore).toHaveBeenCalledTimes(screen + 1);
    await scroll(viewport * (screen + 0.7));
    expect(loadMore).toHaveBeenCalledTimes(screen + 2);
    expect(list().scrollTop).toBe(viewport * (screen + 0.7));
  }
});

it('fills the extra screen across short pages without overlapping requests', async () => {
  let finish!: () => void;
  loadMore.mockImplementation(() => new Promise<void>(resolve => {
    finish = () => { content += viewport / 2; cursor += '-next'; root.render(<Harness />); resolve(); };
  }));
  await render();
  await act(async () => { resize(); resize(); });
  expect(loadMore).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(loadMore).toHaveBeenCalledTimes(2);
  await act(async () => finish());
  expect(content).toBe(viewport * 2);
  expect(loadMore).toHaveBeenCalledTimes(2);
});

it('refills for a taller viewport and stops when the list is exhausted', async () => {
  content = 800;
  loadMore.mockImplementation(async () => { content += viewport; cursor = null; root.render(<Harness />); });
  await render();
  expect(loadMore).not.toHaveBeenCalled();
  viewport = 600;
  await act(async () => resize());
  expect(loadMore).toHaveBeenCalledTimes(1);
  await scroll(content - viewport);
  expect(loadMore).toHaveBeenCalledTimes(1);
});

it('pauses a failed page until retry and disconnects its layout observer on unmount', async () => {
  loadMore.mockRejectedValueOnce(new Error('offline')).mockImplementation(async () => {
    content += viewport; cursor = null; root.render(<Harness />);
  });
  await render();
  await act(async () => { resize(); resize(); });
  await scroll(10);
  expect(loadMore).toHaveBeenCalledTimes(1);
  await act(async () => container.querySelector('button')!.click());
  expect(loadMore).toHaveBeenCalledTimes(2);
  await act(async () => root.render(null));
  expect(disconnect).toHaveBeenCalledOnce();
});

it('waits until the list is connected and visible before preloading', async () => {
  ready = false;
  loadMore.mockResolvedValue();
  await render();
  expect(loadMore).not.toHaveBeenCalled();
  ready = true; viewport = 0;
  await render();
  expect(loadMore).not.toHaveBeenCalled();
  viewport = 400;
  await act(async () => resize());
  expect(loadMore).toHaveBeenCalledTimes(1);
});
