import { useContext, useEffect, useRef, useState } from 'react';
import { Globe } from 'lucide-react';
import type { BrowserReply } from '../browser/automation';
import type { BrowserSurfaceProps } from '../provider-market/ProviderBrowser';
import { BrowserClientContext } from '../../apps/desktop/src/pages/codexGui/filePreview/browserClient';
import { remoteStatusPage } from './remoteStatusPage';

const PREVIEW_REFRESH_MS = 2_000;
export function RemoteStatusSurface({ tab, active, command, onNavigate, t }: BrowserSurfaceProps) {
  const client = useContext(BrowserClientContext);
  const session = useRef<ReturnType<typeof remoteStatusPage>>();
  const [frame, setFrame] = useState<BrowserReply['result']>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const current = useRef({ onNavigate, url: tab.url }); current.current.onNavigate = onNavigate;
  useEffect(() => {
    if (!tab.url) return;
    const page = remoteStatusPage(client, tab.id, tab.url);
    session.current = page;
    current.current.url = tab.url;
    setFrame(undefined); setFailed(false);
    return () => {
      session.current = undefined;
      void page.close().catch(error => console.debug('Status browser cleanup failed', error));
    };
    // URL changes navigate the existing tab below.
  }, [client, tab.id, Boolean(tab.url), attempt]);
  useEffect(() => {
    if (!active || !session.current) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const page = session.current;
    const read = async () => {
      try {
        const result = await page.read();
        if (stopped) return;
        if (result.image) { setFrame(result); setFailed(false); }
        if (result.url && result.url !== 'about:blank' && result.url !== current.current.url) {
          current.current.url = result.url; current.current.onNavigate(result.url);
        }
      } catch { if (!stopped) setFailed(true); }
      finally { if (!stopped) timer = setTimeout(() => void read(), PREVIEW_REFRESH_MS); }
    };
    void read();
    return () => { stopped = true; clearTimeout(timer); };
  }, [active, client, tab.id, Boolean(tab.url), attempt]);
  useEffect(() => {
    if (!tab.url || tab.url === current.current.url) return;
    current.current.url = tab.url;
    void session.current?.command({ action: 'navigate', url: tab.url }).catch(() => setFailed(true));
  }, [tab.url]);
  useEffect(() => {
    if (command) void session.current?.command({ action: command.action }).catch(() => setFailed(true));
  }, [command]);
  const viewport = frame?.viewport ?? { width: 1000, height: 700 };
  return <div className="pm-browser-surface codex-status-preview" onWheel={event => {
    if (!active || !frame) return;
    void session.current?.command({ action: 'scroll', x: 0,
      y: Math.max(-1000, Math.min(1000, Math.round(event.deltaY))) }).catch(() => setFailed(true));
  }}>
    {(failed || !frame?.image) && <div className="pm-browser-feedback" role="status"><Globe size={32} />
      <p>{t(failed ? 'market.browserFailed' : 'market.loading')}</p>
      {failed && <button onClick={() => setAttempt(value => value + 1)}>{t('market.retry')}</button>}
    </div>}
    {!failed && frame?.image && <div className="codex-status-preview-page" style={{
      width: `min(100cqw, ${100 * viewport.width / viewport.height}cqh)`,
      aspectRatio: `${viewport.width} / ${viewport.height}`,
    }}>
      <img src={`data:${frame.image.mimeType};base64,${frame.image.data}`} alt={tab.title} />
      {frame.elements?.filter(element => element.bounds && element.name && !element.disabled
        && ['a', 'button', 'link', 'summary'].includes(element.role)).map(element => {
        const bounds = element.bounds!;
        return <button key={element.reference} aria-label={element.name} style={{
          left: `${bounds.x / viewport.width * 100}%`, top: `${bounds.y / viewport.height * 100}%`,
          width: `${bounds.width / viewport.width * 100}%`, height: `${bounds.height / viewport.height * 100}%`,
        }} onClick={() => {
          void session.current?.command({ action: 'click', reference: element.reference }).catch(() => setFailed(true));
        }} />;
      })}
    </div>}
  </div>;
}
