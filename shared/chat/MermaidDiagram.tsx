import { Check, Copy } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useDocumentThemeMode } from '../theme/useDocumentThemeMode';
import { useMermaidDiagram } from './useMermaidDiagram';
import './mermaidDiagram.css';

const COPY_FEEDBACK_MS = 2000;

export function MermaidDiagram({ source, previewLabel, sourceLabel, copyLabel }: {
  source: string; previewLabel: string; sourceLabel: string; copyLabel: string;
}) {
  const generatedId = useId().replace(/:/g, '');
  const theme = useDocumentThemeMode();
  const { svg, renderFailed } = useMermaidDiagram(source, theme, `mermaid-${generatedId}`);
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
    } catch {
      // The source view remains available for manual copying.
    }
  };

  const diagramVisible = !showSource && !renderFailed && Boolean(svg);
  return <section className="chat-mermaid-diagram" aria-busy={!svg && !renderFailed}>
    <header className="chat-mermaid-toolbar" data-quote-exclude>
      <div className="chat-mermaid-modes" role="group" aria-label={previewLabel}>
        <button type="button" aria-pressed={diagramVisible} onClick={() => setShowSource(false)}>{previewLabel}</button>
        <button type="button" aria-pressed={!diagramVisible} onClick={() => setShowSource(true)}>{sourceLabel}</button>
      </div>
      <button type="button" className="chat-mermaid-copy" aria-label={copied ? sourceLabel : copyLabel}
        onClick={() => void copy()}>
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </header>
    {diagramVisible ? <div className="chat-mermaid-canvas" dangerouslySetInnerHTML={{ __html: svg }} />
      : <pre className="chat-mermaid-source"><code>{source}</code></pre>}
  </section>;
}
