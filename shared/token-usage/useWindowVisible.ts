import { useEffect, useState } from 'react';
import { useDocumentVisible } from './useDocumentVisible';

const NATIVE_WINDOW_CHECK_MS = 1000;

/** WebView document visibility alone may lag a native minimize/hide operation on Windows. */
export function useWindowVisible(active = true) {
  const documentVisible = useDocumentVisible(active);
  const native = '__TAURI_INTERNALS__' in window;
  const [windowVisible, setWindowVisible] = useState(!native);
  useEffect(() => {
    if (!native) return;
    if (!active) { setWindowVisible(false); return; }
    let disposed = false;
    let running = false;
    let queued = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listeners: (() => void)[] = [];
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      if (disposed) return;
      const current = getCurrentWindow();
      const update = async () => {
        if (disposed) return;
        if (running) { queued = true; return; }
        running = true;
        try {
          const [visible, minimized] = await Promise.all([current.isVisible(), current.isMinimized()]);
          if (!disposed) setWindowVisible(visible && !minimized);
        } finally {
          running = false;
          // An unfocused Windows WebView can be hidden without document/focus/resize events.
          // Only query native window state here; usage data and charts remain suspended while hidden.
          if (!disposed) schedule(queued ? 0 : NATIVE_WINDOW_CHECK_MS);
          queued = false;
        }
      };
      const schedule = (delay = 0) => {
        if (disposed) return;
        clearTimeout(timer);
        timer = setTimeout(() => { void update().catch(() => undefined); }, delay);
      };
      const onStateChange = () => schedule();
      const retain = (stop: () => void) => { if (disposed) stop(); else listeners.push(stop); };
      document.addEventListener('visibilitychange', onStateChange);
      retain(() => document.removeEventListener('visibilitychange', onStateChange));
      await Promise.all([current.onFocusChanged(onStateChange).then(retain), current.onResized(onStateChange).then(retain)]);
      await update();
    }).catch(() => {
      clearTimeout(timer);
      // Older bridges may lack window state queries. Document visibility still gates work.
      if (!disposed) setWindowVisible(true);
    });
    return () => { disposed = true; clearTimeout(timer); listeners.forEach(stop => stop()); };
  }, [native, active]);
  return documentVisible && windowVisible;
}
