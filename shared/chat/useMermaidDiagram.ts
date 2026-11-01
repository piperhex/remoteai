import { useEffect, useState } from 'react';
import type { ThemeMode } from '../theme/mode';
import { renderMermaid } from './mermaidRenderer';

export const MERMAID_INPUT_DEBOUNCE_MS = 200;
type DiagramState = { source: string; theme: ThemeMode; svg: string; failed: boolean };

/** Render after input settles, including completion, cancellation and error terminal text. */
export function useMermaidDiagram(source: string, theme: ThemeMode, id: string) {
  const [result, setResult] = useState<DiagramState>();
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void renderMermaid({ source, theme, id, signal: controller.signal }).then(rendered => {
        if (!controller.signal.aborted && rendered) setResult({ source, theme, svg: rendered.svg, failed: false });
      }).catch(() => {
        if (!controller.signal.aborted) setResult({ source, theme, svg: '', failed: true });
      });
    }, MERMAID_INPUT_DEBOUNCE_MS);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [source, theme, id]);

  // Hide mismatched results during render, before effect cleanup on a source or theme change.
  const current = result?.source === source && result.theme === theme ? result : undefined;
  return { svg: current?.svg ?? '', renderFailed: current?.failed ?? false };
}
