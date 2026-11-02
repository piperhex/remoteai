import { useContext, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Globe } from 'lucide-react';
import type { BrowserSurfaceProps } from '../../../../../../shared/provider-market/ProviderBrowser';
import { ProviderBrowserSurface } from '../../providers/ProviderBrowserSurface';
import { BrowserClientContext } from './browserClient';
import { placeBrowser } from './nativeBrowserPlacement';

export function WebsiteBrowserSurface(props: BrowserSurfaceProps) {
  return props.tab.automationThread ? <ManagedBrowserSurface {...props} /> : <ProviderBrowserSurface {...props} />;
}

function ManagedBrowserSurface({ tab, active, onNavigate, t }: BrowserSurfaceProps) {
  const client = useContext(BrowserClientContext);
  const host = useRef<HTMLDivElement>(null);
  const current = useRef({ active, onNavigate }); current.current = { active, onNavigate };
  const [image, setImage] = useState('');
  const [failed, setFailed] = useState(false);
  const refresh = useRef<() => void>();
  useEffect(() => {
    if (!client.native || !host.current) return;
    const element = host.current;
    let stopped = false;
    let flight = false;
    let pending = false;
    const place = async () => {
      if (flight) { pending = true; return; }
      if (stopped) return;
      flight = true;
      const bounds = element.getBoundingClientRect();
      const modal = [...document.querySelectorAll('[aria-modal="true"]')].some(node => node.getClientRects().length);
      const visible = current.current.active && !document.hidden && !modal && bounds.width > 0 && bounds.height > 0;
      try {
        await placeBrowser({ threadId: tab.automationThread, tabId: tab.id,
          visible, bounds: { x: Math.max(0, bounds.x), y: Math.max(0, bounds.y),
            width: bounds.width, height: bounds.height } });
        if (!stopped) setFailed(false);
      } catch { if (!stopped) setFailed(true); }
      finally { flight = false; if (pending) { pending = false; void place(); } }
    };
    const sync = () => { void place(); }; refresh.current = sync;
    const observer = new ResizeObserver(sync); observer.observe(element);
    const overlays = new MutationObserver(sync);
    overlays.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['style', 'class', 'aria-modal'] });
    window.addEventListener('resize', sync); window.addEventListener('scroll', sync, true);
    document.addEventListener('visibilitychange', sync);
    const listener = listen<{ url: string; popup?: boolean }>(`conversation-browser-${tab.id}`, ({ payload }) => {
      if (!payload.popup) current.current.onNavigate(payload.url);
    });
    void listener.catch(() => setFailed(true)); sync();
    return () => {
      stopped = true; refresh.current = undefined; observer.disconnect(); overlays.disconnect();
      window.removeEventListener('resize', sync); window.removeEventListener('scroll', sync, true);
      document.removeEventListener('visibilitychange', sync);
      void listener.then(stop => stop()).catch(() => {});
      // Preserve the model's tab when the user switches conversations; only release its screen placement.
      void placeBrowser({ threadId: tab.automationThread, tabId: tab.id,
        visible: false, bounds: { x: 0, y: 0, width: 1, height: 1 } })
        .catch(error => console.debug('Browser preview already closed', error));
    };
  }, [client.native, tab.id, tab.automationThread]);
  useEffect(() => { refresh.current?.(); }, [active]);
  useEffect(() => {
    if (client.native || !active || !tab.automationThread) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const reply = await client.request({ threadId: tab.automationThread!, tabId: tab.id,
          command: { action: 'screenshot' } });
        if (stopped) return;
        const image = reply.result?.image;
        if (image) { setImage(`data:${image.mimeType};base64,${image.data}`); setFailed(false); }
        if (reply.result?.url) current.current.onNavigate(reply.result.url);
      } catch { if (!stopped) setFailed(true); }
      finally { if (!stopped) timer = setTimeout(() => { void read(); }, 700); }
    };
    void read();
    return () => { stopped = true; clearTimeout(timer); };
  }, [client, tab.id, tab.automationThread, active]);
  return <div ref={host} className="pm-browser-surface">
    {failed && <div className="pm-browser-feedback" role="status"><Globe size={32} /><p>{t('market.browserFailed')}</p></div>}
    {!client.native && image && !failed && <img className="website-browser-stream" src={image} alt={tab.title} />}
  </div>;
}
