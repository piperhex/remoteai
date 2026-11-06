import { useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import type { Provider } from '../../types';
import { hasMarketPage, validPageLink } from '../../../../../shared/provider-market/pageLink';
import type { MarketItem } from '../../../../../shared/provider-market/types';
import { createBrowserTab, moveTab, navigateTab, type BrowserAction, type BrowserTab }
  from '../../../../../shared/provider-market/browserState';
import type { BrowserSurfaceProps } from '../../../../../shared/provider-market/ProviderBrowser';
import { remainingBrowserTabs } from '../../../../../shared/provider-market/browserTabCommands';

export function useProviderBrowser() {
  const [open, setOpen] = useState(false);
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeId, setActiveId] = useState('');
  const [commands, setCommands] = useState<Record<string, BrowserSurfaceProps['command']>>({});
  const sequence = useRef(0);
  const addTab = (tab: BrowserTab) => {
    setTabs((current) => [...current, tab]); setActiveId(tab.id); setOpen(true);
  };
  const openProvider = (provider: Provider) => {
    if (!hasMarketPage(provider) || !provider.marketSource) return;
    addTab(createBrowserTab({ name: provider.name, marketSource: provider.marketSource }));
  };
  const openMarketItem = (item: MarketItem) => {
    if (!validPageLink(item.pageLink)) return;
    addTab(createBrowserTab({ name: item.name, marketSource: { id: item.id, page: item.pageLink } }));
  };
  const closeTabs = (ids: string[]) => {
    const remaining = remainingBrowserTabs(tabs, activeId, ids);
    setTabs(remaining.tabs); setActiveId(remaining.activeId);
    setCommands(current => { const next = { ...current }; ids.forEach(id => { delete next[id]; }); return next; });
    if (!remaining.tabs.length) setOpen(false);
  };
  const navigate = (id: string, url: string) => setTabs((current) => current.map((tab) =>
    tab.id === id ? navigateTab(tab, url) : tab));
  const popup = (id: string, url: string) => {
    const parent = tabs.find((tab) => tab.id === id);
    if (!parent) return;
    const next = navigateTab(createBrowserTab(), url);
    addTab({ ...next, title: new URL(url).hostname, headers: { ...parent.headers }, headerOrigin: parent.headerOrigin });
  };
  const action = (id: string, action: BrowserAction) => {
    if (!isTauri() && (action === 'back' || action === 'forward')) {
      setTabs((current) => current.map((tab) => tab.id === id ? moveTab(tab, action === 'back' ? -1 : 1) : tab));
      return;
    }
    sequence.current += 1;
    setCommands((current) => ({ ...current, [id]: { action, sequence: sequence.current } }));
  };
  return { openProvider, openMarketItem, window: { open, tabs, activeId, commands, onSelect: setActiveId,
    onCloseTab: (id: string) => closeTabs([id]), onCloseTabs: closeTabs,
    onNewTab: () => addTab(createBrowserTab()), onClose: () => setOpen(false),
    onNavigate: navigate, onAction: action, onPopup: popup } };
}
