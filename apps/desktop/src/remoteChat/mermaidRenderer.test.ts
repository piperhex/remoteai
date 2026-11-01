// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { instantiateMermaidSvg, MermaidCache } from '../../../../shared/chat/mermaidCache';

const renderer = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({ default: renderer }));
beforeEach(() => { vi.resetModules(); renderer.render.mockReset(); renderer.initialize.mockReset(); });

const options = (source: string, signal = new AbortController().signal) => ({ source, signal, id: 'instance',
  theme: 'light' as const });
const svg = (text: string) => `<svg id="render" xmlns="http://www.w3.org/2000/svg"><text>${text}</text></svg>`;
function deferred() {
  let resolve!: (result: { svg: string }) => void;
  const promise = new Promise<{ svg: string }>(done => { resolve = done; });
  return { resolve, promise };
}

it('removes queued jobs immediately, keeps running layout serialized, and discards its result', async () => {
  const { renderMermaid, mermaidRenderStats } = await import('../../../../shared/chat/mermaidRenderer');
  const active = deferred();
  renderer.render.mockReturnValueOnce(active.promise).mockResolvedValue({ svg: svg('final') });
  const running = new AbortController();
  const old = renderMermaid(options('old', running.signal));
  await vi.waitFor(() => expect(renderer.render).toHaveBeenCalledTimes(1));
  const waiting = new AbortController();
  const skipped = renderMermaid(options('skipped', waiting.signal));
  waiting.abort(); await expect(skipped).resolves.toBeNull();
  running.abort();
  const final = renderMermaid(options('final'));
  expect(mermaidRenderStats()).toMatchObject({ queued: 1, running: true, layouts: 1 });
  active.resolve({ svg: svg('old') });
  await expect(old).resolves.toBeNull();
  await expect(final).resolves.toMatchObject({ svg: expect.stringContaining('final') });
  expect(renderer.render.mock.calls.map(call => call[1])).toEqual(['old', 'final']);
  expect(mermaidRenderStats()).toMatchObject({ layouts: 2, cancelledBeforeLayout: 1, discardedResults: 1 });
  expect(document.querySelector('[data-mermaid-render]')).toBeNull();
});

it('deduplicates queued identical diagrams, isolates themes and reuses the original theme', async () => {
  const { renderMermaid, mermaidRenderStats } = await import('../../../../shared/chat/mermaidRenderer');
  renderer.render.mockResolvedValue({ svg: svg('cached') });
  const light = options('same');
  const results = await Promise.all([renderMermaid(light), renderMermaid({ ...light, id: 'second' })]);
  expect(results[0]?.svg).not.toBe(results[1]?.svg);
  await renderMermaid({ ...light, theme: 'dark' });
  await renderMermaid(light);
  await renderMermaid(options('different source'));
  expect(mermaidRenderStats()).toMatchObject({ requests: 5, layouts: 3, cacheHits: 2, cacheEntries: 3 });
  expect(renderer.initialize.mock.calls.map(call => call[0].themeVariables.darkMode)).toEqual([false, true, false]);
  expect(renderer.initialize.mock.calls.every(call => call[0].securityLevel === 'strict')).toBe(true);
});

it('does not cache errors, cleans failed layouts and allows later valid input', async () => {
  const { renderMermaid, mermaidRenderStats } = await import('../../../../shared/chat/mermaidRenderer');
  renderer.render.mockRejectedValueOnce(new Error('invalid')).mockRejectedValueOnce(new Error('incomplete'))
    .mockResolvedValueOnce({ svg: svg('recovered') });
  await expect(renderMermaid(options('bad'))).rejects.toThrow('invalid');
  await expect(renderMermaid(options('bad'))).rejects.toThrow('incomplete');
  await expect(renderMermaid(options('valid'))).resolves.toMatchObject({ svg: expect.stringContaining('recovered') });
  expect(mermaidRenderStats()).toMatchObject({ failures: 2, layouts: 3, cacheHits: 0, cacheEntries: 1 });
  expect(document.querySelector('[data-mermaid-render]')).toBeNull();
});

it('suppresses errors from aborted active layouts without poisoning the queue', async () => {
  const { renderMermaid } = await import('../../../../shared/chat/mermaidRenderer');
  let reject!: (error: Error) => void;
  renderer.render.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }))
    .mockResolvedValue({ svg: svg('new session') });
  const controller = new AbortController();
  const old = renderMermaid(options('invalid old', controller.signal));
  await vi.waitFor(() => expect(renderer.render).toHaveBeenCalledTimes(1));
  controller.abort(); reject(new Error('late error'));
  await expect(old).resolves.toBeNull();
  await expect(renderMermaid(options('new'))).resolves.toMatchObject({ svg: expect.stringContaining('new session') });
});

it('evicts least-recently-used entries and enforces byte limits including source keys', () => {
  const cache = new MermaidCache({ entries: 2, bytes: 24 });
  cache.set('a', '123'); cache.set('b', '123'); cache.get('a'); cache.set('c', '123');
  expect(cache.get('b')).toBeUndefined(); expect(cache.get('a')).toBe('123');
  cache.set('d', '12345');
  expect(cache.size).toBe(2); expect(cache.retainedBytes).toBe(20);
  cache.set('huge-source-key', 'x');
  expect(cache.size).toBe(2); expect(cache.retainedBytes).toBe(20);
  cache.set('d', '12345678901');
  expect(cache.size).toBe(1); expect(cache.retainedBytes).toBe(24);
});

it('namespaces IDs, CSS, url(), href and aria references without changing labels or external links', () => {
  const source = `<svg id="root" aria-labelledby="title description"><style>#root .edge{marker-end:url(#arrow)}</style>
    <title id="title">#root url(#arrow)</title><desc id="description">Original text</desc>
    <defs><marker id="arrow"/><path id="path"/></defs><path style="marker-end:url('#arrow')"/>
    <use href="#path"/><a href="https://example.test/#path"><text>#path</text></a>
    <a data-local-link href="#path.other">Other fragment</a></svg>`;
  const host = document.createElement('div');
  host.innerHTML = instantiateMermaidSvg(source, 'first') + instantiateMermaidSvg(source, 'second');
  const ids = Array.from(host.querySelectorAll('[id]'), element => element.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const diagram of Array.from(host.querySelectorAll('svg'))) {
    expect(diagram.querySelector('style')?.textContent).toContain(`#${diagram.id}`);
    for (const id of diagram.getAttribute('aria-labelledby')!.split(' ')) {
      expect(diagram.querySelector(`[id="${id}"]`)).not.toBeNull();
    }
    const reference = diagram.querySelector('use')!.getAttribute('href')!;
    expect(diagram.querySelector(reference)).not.toBeNull();
    const arrow = diagram.querySelector('marker')!.id;
    expect(diagram.innerHTML).toContain(`url(#${arrow})`);
    expect(diagram.innerHTML).toContain(`url('#${arrow}')`);
    expect(diagram.querySelector('title')?.textContent).toBe('#root url(#arrow)');
    expect(diagram.querySelector('a')?.getAttribute('href')).toBe('https://example.test/#path');
    expect(diagram.querySelector('[data-local-link]')?.getAttribute('href')).toBe('#path.other');
  }
});
