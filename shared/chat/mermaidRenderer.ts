import { themeColor, type ThemeMode } from '../theme/mode';

type RenderOptions = { source: string; id: string; theme: ThemeMode; signal: AbortSignal };

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

let pending: Promise<unknown> = Promise.resolve();

/** Mermaid's configuration is global; configure and render each diagram in the same queue. */
export function renderMermaid({ source, id, theme, signal }: RenderOptions) {
  const result = pending.then(async () => {
    if (signal.aborted) return null;
    const { default: mermaid } = await import('mermaid');
    if (signal.aborted) return null;
    mermaid.initialize({
      startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: 'base',
      themeVariables: diagramColors(theme),
      flowchart: { htmlLabels: false, useMaxWidth: false, curve: 'basis' },
    });
    const container = document.createElement('div');
    container.dataset.mermaidRender = id;
    container.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none;overflow:hidden';
    document.body.append(container);
    try {
      return await mermaid.render(id, source, container);
    } finally {
      // Also clean up renderer failures and diagram directives that re-enable error SVGs.
      container.remove();
    }
  });
  // A malformed streamed block must not prevent later diagrams from rendering.
  pending = result.catch(() => undefined);
  return result;
}
