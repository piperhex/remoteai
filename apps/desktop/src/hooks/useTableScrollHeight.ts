import { useEffect, useRef, useState } from 'react';

/** Keep the fixed-header table mounted while its page is hidden. */
export function useTableScrollHeight(toolbarSelector: string, active = true) {
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [tableScrollY, setTableScrollY] = useState(1);
  useEffect(() => {
    const tableWrap = tableWrapRef.current;
    if (!active || !tableWrap) return;
    const update = () => {
      const height = tableWrap.clientHeight;
      // Hidden panels report zero; retaining the last height also preserves scroll position.
      if (!height) return;
      const header = tableWrap.querySelector('.ant-table-thead')?.getBoundingClientRect().height ?? 0;
      const toolbar = tableWrap.querySelector(toolbarSelector)?.getBoundingClientRect().height ?? 0;
      setTableScrollY(Math.max(1, Math.floor(height - header - toolbar)));
    };
    const observer = new ResizeObserver(update);
    observer.observe(tableWrap);
    update();
    return () => observer.disconnect();
  }, [active, toolbarSelector]);
  return { tableWrapRef, tableScrollY };
}
