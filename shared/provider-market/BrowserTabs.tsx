import { useEffect, useState } from 'react';
import { Dropdown } from 'antd';
import { Ellipsis, Globe, X } from 'lucide-react';
import { useTabOverflow } from '../project-browser/useTabOverflow';
import type { BrowserTab } from './browserState';
import type { MarketText } from './i18n';

interface Props {
  tabs: BrowserTab[]; activeId: string; visible: boolean; t: MarketText;
  select: (id: string) => void; close: (id: string) => void; menuChanged: (open: boolean) => void;
}

/** Match project and workspace tabs: reveal the selection, fade the clipped left edge and list hidden tabs. */
export function BrowserTabs({ tabs, activeId, visible, t, select, close, menuChanged }: Props) {
  const overflow = useTabOverflow(tabs.map(tab => ({ path: tab.id })), activeId);
  const hidden = tabs.filter(tab => overflow.hiddenPaths.includes(tab.id));
  const [open, setOpen] = useState(false);
  const name = (tab: BrowserTab) => tab.title || t('market.browserNewTab');
  const focusSelected = () => overflow.viewport.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
    ?.focus({ preventScroll: true });
  const choose = (id: string) => {
    overflow.reveal(id); select(id); setOpen(false); requestAnimationFrame(focusSelected);
  };
  const closeTab = (id: string) => { close(id); setOpen(false); requestAnimationFrame(focusSelected); };
  useEffect(() => { if (!visible || !hidden.length) setOpen(false); }, [visible, hidden.length]);
  useEffect(() => { menuChanged(open); }, [open, menuChanged]);
  return <div ref={overflow.bar} className="pm-browser-tabs-bar" data-clipped-left={overflow.clippedLeft}
    onKeyDown={event => {
      if (!open || event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); setOpen(false);
      event.currentTarget.querySelector<HTMLButtonElement>('.pm-browser-tabs-more')?.focus();
    }}>
    <div ref={overflow.viewport} className="pm-browser-tabs" role="tablist" aria-label={t('market.browserTabs')}>
      {tabs.map((tab, index) => <div className={`pm-browser-tab${tab.id === activeId ? ' active' : ''}`} key={tab.id}
        data-overflow-tab data-path={tab.id} data-active={tab.id === activeId}>
        <button type="button" role="tab" aria-selected={tab.id === activeId} tabIndex={tab.id === activeId ? 0 : -1}
          aria-controls={`page-${tab.id}`} onClick={() => choose(tab.id)} title={name(tab)}
          onKeyDown={event => {
            const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1,
              Home: -index, End: tabs.length - index - 1 };
            if (!(event.key in offsets)) return;
            event.preventDefault(); choose(tabs[(index + offsets[event.key] + tabs.length) % tabs.length].id);
          }}><Globe size={14} /><span>{name(tab)}</span></button>
        <button type="button" aria-label={t('market.browserCloseTab', { name: name(tab) })}
          onClick={() => closeTab(tab.id)}><X size={14} /></button>
      </div>)}
    </div>
    {overflow.overflowing && <Dropdown trigger={['click']} open={open} onOpenChange={setOpen} autoFocus
      placement="bottomRight" getPopupContainer={trigger => trigger.parentElement ?? trigger}
      overlayClassName="pm-browser-tabs-menu" menu={{ 'aria-label': t('market.browserHiddenTabs'),
        items: hidden.map(tab => ({ key: tab.id, label: <div className="pm-browser-tabs-menu-item">
          <Globe size={14} /><span>{name(tab)}</span>
          <button type="button" aria-label={t('market.browserCloseTab', { name: name(tab) })}
            onClick={event => { event.stopPropagation(); closeTab(tab.id); }}><X size={14} /></button>
        </div> })), onClick: ({ key }) => choose(key),
      }}>
      <button type="button" className="pm-browser-tabs-more" aria-label={t('market.browserMoreTabs')}
        aria-haspopup="menu" aria-expanded={open}><Ellipsis size={18} /></button>
    </Dropdown>}
  </div>;
}
