import { useEffect, useRef, useState } from 'react';
import { isTauri, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Globe } from 'lucide-react';
import type { BrowserSurfaceProps } from '../../../../../shared/provider-market/ProviderBrowser';
import { nativeBrowserSession } from './providerBrowserSession';

function browserFeedback(state: { url: string; unsupported: boolean; needsDesktop: boolean; failed: boolean }) {
  if (!state.url) return 'market.browserBlank';
  if (state.unsupported) return 'market.browserHeadersUnsupported';
  if (state.needsDesktop) return 'market.browserHeadersDesktop';
  if (state.failed) return 'market.browserFailed';
  return null;
}

export function ProviderBrowserSurface({ tab, active, command, onNavigate, onPopup, t, hideForModal }: BrowserSurfaceProps) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const desktop = isTauri();
  const state = useRef({ tab, active, onNavigate, onPopup });
  state.current = { tab, active, onNavigate, onPopup };
  const refresh = useRef<() => void>();
  const nativeNavigation = useRef('');
  const lastCommand = useRef(0);
  const needsDesktop = !desktop && Object.keys(tab.headers).length > 0;
  useEffect(() => {
    if (!desktop || !host.current) return;
    const element = host.current;
    const session = nativeBrowserSession(tab.id, (reason) => {
      setUnsupported(String(reason).includes('market.browserHeadersUnsupported')); setFailed(true);
    });
    let frame = 0;
    let modalVisible = false;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const current = state.current;
        const bounds = element.getBoundingClientRect();
        const visible = current.active && !modalVisible && !document.hidden && bounds.width > 0 && bounds.height > 0;
        if (!current.tab.url) return;
        session.update({ url: current.tab.url, headers: current.tab.headers,
          headerOrigin: current.tab.headerOrigin, visible,
          navigate: nativeNavigation.current !== current.tab.url,
          bounds: { x: Math.max(0, bounds.x), y: Math.max(0, bounds.y),
            width: bounds.width, height: bounds.height } });
      });
    };
    refresh.current = sync;
    const unlisten = listen<{ url: string; popup?: boolean }>(`provider-browser-${tab.id}`, ({ payload }) => {
      if (payload.popup) { state.current.onPopup(payload.url); return; }
      nativeNavigation.current = payload.url;
      state.current.onNavigate(payload.url);
    });
    void unlisten.catch(() => setFailed(true));
    const observer = new ResizeObserver(sync); observer.observe(element);
    const checkModal = () => {
      const visible = Boolean(hideForModal) && [...document.querySelectorAll('[aria-modal="true"]')]
        .some(dialog => dialog.getClientRects().length > 0);
      if (visible !== modalVisible) { modalVisible = visible; sync(); }
    };
    const overlays = new MutationObserver(checkModal);
    overlays.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['style', 'class', 'aria-modal'] });
    checkModal();
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    document.addEventListener('animationend', sync, true);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      refresh.current = undefined; cancelAnimationFrame(frame); observer.disconnect(); overlays.disconnect();
      window.removeEventListener('resize', sync); document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('scroll', sync, true); document.removeEventListener('animationend', sync, true);
      // Listener registration failure is already surfaced above; cleanup has nothing to remove then.
      void unlisten.then((stop) => stop()).catch(() => {});
      void session.close().catch((error) => console.error('Provider browser close failed', error));
    };
  }, [desktop, tab.id, attempt, hideForModal]);
  useEffect(() => { refresh.current?.(); }, [active, tab.url]);
  useEffect(() => {
    if (!command || command.sequence === lastCommand.current) return;
    lastCommand.current = command.sequence;
    if (!desktop) { setAttempt((value) => value + 1); setFailed(false); return; }
    void invoke('provider_browser_action', { id: tab.id, action: command.action })
      .catch(() => setFailed(true));
  }, [command, desktop, tab.id]);
  const feedback = browserFeedback({ url: tab.url, unsupported, needsDesktop, failed });
  return <div className="pm-browser-surface" ref={host}>
    {feedback && <div className="pm-browser-feedback" role="status"><Globe size={32} /><p>{t(feedback)}</p>
      {failed && <button onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>
        {t('market.retry')}</button>}</div>}
    {!feedback && !desktop && <iframe key={attempt} src={tab.url} title={tab.title || t('market.browserNewTab')}
      sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
    {!desktop && !feedback && <div className="pm-browser-web-notice">{t('market.browserWebNotice')}</div>}
  </div>;
}
