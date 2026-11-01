import { themeColor, type ThemeMode } from '../theme/mode';
import { instantiateMermaidSvg, MermaidCache } from './mermaidCache';

type RenderOptions = { source: string; id: string; theme: ThemeMode; signal: AbortSignal };
type RenderResult = { svg: string } | null;
type Job = { options: RenderOptions; resolve: (result: RenderResult) => void;
  reject: (error: unknown) => void; detach: () => void };

function diagramColors(mode: ThemeMode) {
  const color = themeColor(mode);
  const surface = color('#eff7f3', 'surface');
  const ink = color('#17251f', 'ink');
  const border = color('#328575', 'accent');
  const line = color('#718079', 'muted');
  const canvas = color('#ffffff', 'surface');
  return {
    darkMode: mode === 'dark', primaryColor: surface, primaryTextColor: ink, primaryBorderColor: border,
    secondaryColor: color('#f5f8f6', 'elevated'), tertiaryColor: canvas, background: canvas,
    textColor: ink, lineColor: line, edgeLabelBackground: canvas,
    actorBkg: surface, actorBorder: border, actorTextColor: ink,
    signalColor: line, signalTextColor: ink, labelBoxBkgColor: surface, labelBoxBorderColor: border,
    labelTextColor: ink, loopTextColor: ink, noteBkgColor: surface, noteTextColor: ink, noteBorderColor: border,
  };
}

const cache = new MermaidCache();
const queue: Job[] = [];
const counts = { requests: 0, layouts: 0, cacheHits: 0, cancelledBeforeLayout: 0, discardedResults: 0, failures: 0 };
// All layout options are fixed below. Bump this revision when those options or the palette change.
const CONFIG_REVISION = 1;
let running = false;
let layoutSequence = 0;

/** Read-only counters for controlled-input diagnostics; no diagram content is exposed. */
export function mermaidRenderStats() {
  return { ...counts, queued: queue.length, running, cacheEntries: cache.size, cacheBytes: cache.retainedBytes };
}

async function layout({ source, theme, signal }: RenderOptions) {
  const { default: mermaid } = await import('mermaid');
  if (signal.aborted) { counts.cancelledBeforeLayout++; return null; }
  mermaid.initialize({
    startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: 'base',
    themeVariables: diagramColors(theme),
    flowchart: { htmlLabels: false, useMaxWidth: false, curve: 'basis' },
  });
  const id = `mermaid-layout-${++layoutSequence}`;
  const container = document.createElement('div');
  container.dataset.mermaidRender = id;
  container.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none;overflow:hidden';
  document.body.append(container);
  counts.layouts++;
  try {
    return (await mermaid.render(id, source, container)).svg;
  } finally {
    // Also clean up renderer failures and diagram directives that re-enable error SVGs.
    container.remove();
  }
}

async function execute(options: RenderOptions): Promise<RenderResult> {
  const { source, theme, id, signal } = options;
  const key = JSON.stringify([CONFIG_REVISION, theme, source]);
  const cached = cache.get(key);
  if (cached !== undefined) { counts.cacheHits++; return { svg: instantiateMermaidSvg(cached, id) }; }
  const svg = await layout(options);
  if (svg === null) return null;
  // Mermaid cannot cancel an active layout. Keep the serial slot until it finishes, then discard its result.
  if (signal.aborted) { counts.discardedResults++; return null; }
  const result = { svg: instantiateMermaidSvg(svg, id) };
  cache.set(key, svg);
  return result;
}

/** Global configuration and layouts must share one serial queue, including failed/aborted layouts. */
async function drain() {
  if (running) return;
  running = true;
  try {
    let job: Job | undefined;
    while ((job = queue.shift())) {
      try { job.resolve(await execute(job.options)); }
      catch (error) {
        if (job.options.signal.aborted) { counts.discardedResults++; job.resolve(null); }
        else { counts.failures++; job.reject(error); }
      } finally { job.detach(); }
    }
  } finally { running = false; }
}

/** Abort removes pending jobs immediately; running Mermaid work only has its eventual result ignored. */
export function renderMermaid(options: RenderOptions): Promise<RenderResult> {
  counts.requests++;
  if (options.signal.aborted) { counts.cancelledBeforeLayout++; return Promise.resolve(null); }
  return new Promise((resolve, reject) => {
    const cancel = () => {
      const index = queue.indexOf(job);
      if (index < 0) return;
      queue.splice(index, 1); job.detach(); counts.cancelledBeforeLayout++; resolve(null);
    };
    const job: Job = { options, resolve, reject,
      detach: () => options.signal.removeEventListener('abort', cancel) };
    options.signal.addEventListener('abort', cancel, { once: true });
    queue.push(job);
    void drain();
  });
}
