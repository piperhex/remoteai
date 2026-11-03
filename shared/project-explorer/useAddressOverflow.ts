import { useLayoutEffect, useRef, useState } from 'react';

/** Keep complete trailing breadcrumbs; the current folder may shrink if its name alone is too wide. */
export function hiddenAddressParts(widths: number[], available: number, overflowWidth: number) {
  if (widths.reduce((sum, width) => sum + width, 0) <= available) return 0;
  let first = Math.max(0, widths.length - 1);
  let used = overflowWidth + (widths[first] ?? 0);
  while (first > 1 && used + widths[first - 1] <= available) {
    used += widths[--first];
  }
  return first;
}

export function useAddressOverflow(parts: { name: string; path: string }[]) {
  const container = useRef<HTMLElement>(null);
  const measurement = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(0);
  useLayoutEffect(() => {
    const viewport = container.current;
    const row = measurement.current;
    if (!viewport || !row) return;
    const measure = () => {
      const widths = Array.from(row.children, node => node.getBoundingClientRect().width);
      const overflowWidth = widths.pop() ?? 0;
      setHidden(hiddenAddressParts(widths, viewport.getBoundingClientRect().width, overflowWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(row);
    return () => observer.disconnect();
  }, [parts]);
  return { container, measurement, hidden };
}
