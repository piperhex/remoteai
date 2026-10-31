import { useMemo, useRef, useState } from 'react';
import { estimatedTextHeight, textChunks, textWindow, TEXT_VIEWPORT_HEIGHT,
  type TextMeasurement } from './virtualText';

interface Metrics { width: number; height: number; characterWidth: number; lineHeight: number }
const INITIAL_METRICS: Metrics = { width: 320, height: TEXT_VIEWPORT_HEIGHT, characterWidth: 8, lineHeight: 24 };

/** Bounded text rendering for independently scrolling output panes on native and mobile web. */
export function useVirtualText(text: string) {
  const chunks = useMemo(() => textChunks(text), [text]);
  const [metrics, setMetrics] = useState(INITIAL_METRICS);
  const [offset, setOffset] = useState(0);
  const [measurements, setMeasurements] = useState(new Map<number, TextMeasurement>());
  const layout = useRef(metrics);
  const heights = useMemo(() => chunks.map(chunk => {
    const measured = measurements.get(chunk.start);
    return measured?.text === chunk.text ? measured.height : estimatedTextHeight(chunk.text, metrics);
  }), [chunks, measurements, metrics]);
  const window = textWindow(heights, offset, metrics.height);
  const resize = (next: Metrics) => {
    const previous = layout.current;
    if (Object.keys(next).every(key => next[key as keyof Metrics] === previous[key as keyof Metrics])) return;
    if (next.width !== previous.width || next.characterWidth !== previous.characterWidth
      || next.lineHeight !== previous.lineHeight) setMeasurements(new Map());
    layout.current = next;
    setMetrics(next);
  };
  const measure = (start: number, content: string, height: number) => {
    if (!Number.isFinite(height) || height <= 0) return;
    setMeasurements(current => {
      const previous = current.get(start);
      if (previous?.text === content && previous.height === height) return current;
      return new Map(current).set(start, { text: content, height });
    });
  };
  return { rows: chunks.slice(window.start, window.end), before: window.before, after: window.after,
    resize, measure, scroll: (value: number) => setOffset(Math.max(0, value)) };
}
