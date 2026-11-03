import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Globe, Maximize2, Minimize2, Plus, RotateCw, X } from 'lucide-react';
import { marketText, type MarketText } from './i18n';
import type { Language } from '@remoteai/i18n';
import { pageUrl } from './pageLink';
import type { BrowserAction, BrowserTab } from './browserState';
import { BrowserTabs } from './BrowserTabs';
import './providerBrowser.css';

export interface BrowserSurfaceProps {
  tab: BrowserTab; active: boolean; command: { sequence: number; action: BrowserAction } | null;
  onNavigate: (url: string) => void; t: MarketText;
  onPopup: (url: string) => void;
  hideForModal?: boolean;
}
export interface BrowserWindowProps {
  title?: string;
  open: boolean; tabs: BrowserTab[]; activeId: string; language: Language;
  onSelect: (id: string) => void; onCloseTab: (id: string) => void; onNewTab: () => void; onClose: () => void;
  onNavigate: (id: string, url: string) => void; onAction: (id: string, action: BrowserAction) => void;
  onPopup: (id: string, url: string) => void;
  commands: Record<string, BrowserSurfaceProps['command']>; Surface: ComponentType<BrowserSurfaceProps>;
}

function BrowserToolbar({ tab, fullscreen, toggleFullscreen, navigate, action, t, actions }: {
  tab?: BrowserTab; fullscreen: boolean; toggleFullscreen: () => void;
  navigate: (url: string) => void; action: (action: BrowserAction) => void; t: MarketText; actions?: ReactNode;
}) {
  const [address, setAddress] = useState(tab?.url ?? '');
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setAddress(tab?.url ?? ''); setInvalid(false); }, [tab?.id, tab?.url]);
  return <div className="pm-browser-toolbar">
    <button aria-label={t('market.browserBack')} title={t('market.browserBack')}
      disabled={!tab?.url} onClick={() => action('back')}><ArrowLeft size={17} /></button>
    <button aria-label={t('market.browserForward')} title={t('market.browserForward')}
      disabled={!tab?.url} onClick={() => action('forward')}><ArrowRight size={17} /></button>
    <button aria-label={t('market.browserReload')} title={t('market.browserReload')}
      disabled={!tab?.url} onClick={() => action('reload')}><RotateCw size={17} /></button>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (tab?.url.startsWith('file:') && address.trim() === tab.url) {
        setInvalid(false); action('reload'); return;
      }
      const url = pageUrl(address.trim());
      setInvalid(!url);
      if (url) navigate(url.toString());
    }}>
      <Globe size={15} /><input aria-label={t('market.browserAddress')} aria-invalid={invalid}
        value={address} onChange={(event) => { setAddress(event.target.value); setInvalid(false); }}
        placeholder="https://example.com" spellCheck={false} autoComplete="off" />
      <button type="submit" aria-label={t('market.visitPage')}><ArrowRight size={16} /></button>
    </form>
    {actions}
    <button aria-label={t(fullscreen ? 'market.browserRestore' : 'market.browserFullscreen')}
      title={t(fullscreen ? 'market.browserRestore' : 'market.browserFullscreen')} onClick={toggleFullscreen}>
      {fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
    {invalid && <span className="pm-browser-address-error" role="alert">{t('market.browserInvalidUrl')}</span>}
  </div>;
}

/** Browser chrome shared by the Provider dialog and the conversation sidebar. */
export function BrowserContents(props: BrowserWindowProps & {
  fullscreen: boolean; toggleFullscreen: () => void; embedded?: boolean; actions?: ReactNode;
  onPageNavigate?: (id: string, url: string) => void; history?: ReactNode;
}) {
  const { tabs, activeId, open, Surface, commands } = props;
  const t = marketText(props.language);
  const tab = tabs.find((entry) => entry.id === activeId);
  const [menuOpen, setMenuOpen] = useState(false);
  return <>
    <div className="pm-browser-titlebar">{props.history}
    <BrowserTabs tabs={tabs} activeId={activeId} visible={open} t={t}
      select={props.onSelect} close={props.onCloseTab} menuChanged={setMenuOpen} />
    <button aria-label={t('market.browserNewTab')} title={t('market.browserNewTab')}
      onClick={props.onNewTab}><Plus size={17} /></button>
    {!props.embedded && <button aria-label={t('market.close')} title={t('market.close')}
      onClick={props.onClose}><X size={19} /></button>}</div>
    <BrowserToolbar tab={tab} fullscreen={props.fullscreen} toggleFullscreen={props.toggleFullscreen}
      navigate={(url) => { if (tab) props.onNavigate(tab.id, url); }}
      action={(action) => { if (tab) props.onAction(tab.id, action); }} t={t} actions={props.actions} />
    <div className="pm-browser-pages">{tabs.map((entry) => <div key={entry.id} id={`page-${entry.id}`}
      role="tabpanel" className="pm-browser-page" hidden={entry.id !== activeId}>
      <Surface tab={entry} active={open && entry.id === activeId && !menuOpen} command={commands[entry.id] ?? null}
        hideForModal={props.embedded} onNavigate={(url) => (props.onPageNavigate ?? props.onNavigate)(entry.id, url)}
        onPopup={(url) => props.onPopup(entry.id, url)} t={t} />
    </div>)}</div>
  </>;
}

export function ProviderBrowser(props: BrowserWindowProps) {
  const { open } = props;
  const [fullscreen, setFullscreen] = useState(false);
  const t = marketText(props.language);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => { previous?.focus(); };
  }, [open]);
  return createPortal(<div className="pm-browser-backdrop" hidden={!open}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-label={props.title ?? t('market.browserTitle')} tabIndex={-1}
      className={`pm-browser${fullscreen ? ' pm-browser-fullscreen' : ''}`} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); fullscreen ? setFullscreen(false) : props.onClose(); }
        if (event.key === 'Tab') {
          const elements = [...(dialog.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input, iframe') ?? [])].filter((element) => element.getClientRects().length);
          const first = elements[0]; const last = elements.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <BrowserContents {...props} fullscreen={fullscreen} toggleFullscreen={() => setFullscreen(value => !value)} />
    </section>
  </div>, document.body);
}
