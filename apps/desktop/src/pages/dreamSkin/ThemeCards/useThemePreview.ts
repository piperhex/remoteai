import { useEffect, useRef, useState } from 'react';
import { themeThumbnails } from './themeThumbnails';

interface Options { id: string; preview?: string | null; previewEnabled?: boolean }
const PRELOAD_MARGIN = '240px';

export function useThemePreview({ id, preview, previewEnabled }: Options) {
  const cardRef = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState<{ id: string; source: string | null } | null>(null);

  useEffect(() => {
    const element = cardRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: PRELOAD_MARGIN });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setLoaded(null);
    if (!previewEnabled || !visible || preview) return;
    const request = new AbortController();
    void themeThumbnails.load(id, request.signal).then(source => {
      if (!request.signal.aborted) setLoaded({ id, source });
    }).catch(() => { /* A missing preview leaves the card and its apply action usable. */ });
    return () => request.abort();
  }, [id, preview, previewEnabled, visible]);

  // Remove the CSS image as soon as the card leaves the preload window, including hidden dialogs.
  const resolvedPreview = visible ? preview ?? (previewEnabled && loaded?.id === id ? loaded.source : null) : null;
  return { cardRef, resolvedPreview };
}
