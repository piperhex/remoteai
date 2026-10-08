import { useEffect, useRef, useState, type RefObject } from 'react';

export interface DesktopWindowState {
  minimized: boolean;
  setMinimized: (minimized: boolean) => void;
}

/** Hiding the viewer keeps its media session mounted; only closing it disconnects. */
export function useDesktopWindow(root: RefObject<HTMLElement>, active: boolean, state?: DesktopWindowState) {
  const [internalMinimized, setInternalMinimized] = useState(false);
  const { minimized, setMinimized } = state ?? { minimized: internalMinimized, setMinimized: setInternalMinimized };
  const [fullscreen, setFullscreen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  useEffect(() => {
    const update = () => setFullscreen(!!root.current && document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, [root]);
  useEffect(() => { if (!active) setMinimized(false); }, [active, setMinimized]);

  const run = async (operation: (element: HTMLElement) => Promise<void>, message: string) => {
    const element = root.current;
    if (!element || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await operation(element); }
    catch { if (element.isConnected) setError(message); }
    finally { pending.current = false; setBusy(false); }
  };
  const toggleFullscreen = () => run(async element => {
    if (document.fullscreenElement === element) await document.exitFullscreen();
    else {
      await element.requestFullscreen();
      // A close or disconnect can remove the viewer while fullscreen entry is pending.
      if (!element.isConnected && document.fullscreenElement === element) await document.exitFullscreen();
    }
  }, '暂时无法切换全屏，请重试。');
  const minimize = () => run(async element => {
    if (document.fullscreenElement === element) await document.exitFullscreen();
    if (element.isConnected) setMinimized(true);
  }, '暂时无法退出全屏，请重试。');
  return { minimized, fullscreen, busy, error, toggleFullscreen, minimize,
    restore: () => setMinimized(false) };
}
