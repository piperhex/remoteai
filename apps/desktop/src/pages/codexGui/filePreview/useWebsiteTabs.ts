import { useCallback, useContext, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { message } from 'antd';
import { createBrowserTab, moveTab, navigateTab, type BrowserAction, type BrowserTab }
  from '../../../../../../shared/provider-market/browserState';
import { pageUrl } from '../../../../../../shared/provider-market/pageLink';
import type { BrowserSurfaceProps } from '../../../../../../shared/provider-market/ProviderBrowser';
import { FileEnvironmentContext } from '../fileEnvironment';
import { uiText } from '../../../i18n/uiText';
import type { ManagedBrowserTab } from '../../../../../../shared/browser/automation';
import { BrowserClientContext } from './browserClient';

interface BrowserState {
  tabs: BrowserTab[]; activeId: string; commands: Record<string, BrowserSurfaceProps['command']>;
}
const emptyState = (): BrowserState => ({ tabs: [], activeId: '', commands: {} });
function pageTitle(url: string) {
  const page = pageUrl(url);
  if (!page) return '';
  const name = page.pathname.split('/').filter(Boolean).at(-1);
  return name ? `${name} · ${page.hostname}` : page.hostname;
}

/** Reserve tabs before resolving remote URLs, so rapid clicks cannot replace or reorder pages. */
export function useWebsiteTabs() {
  const environment = useContext(FileEnvironmentContext);
  const client = useContext(BrowserClientContext);
  const [state, setState] = useState<BrowserState>(emptyState);
  const sources = useRef(new Map<string, string>());
  const requests = useRef(new Map<string, symbol>());
  const sequence = useRef(0);
  const currentTabs = useRef(state.tabs); currentTabs.current = state.tabs;
  const managedCommand = useCallback((id: string, command: import('../../../../../../shared/browser/automation').BrowserCommand) => {
    const tab = currentTabs.current.find(tab => tab.id === id);
    if (!tab?.automationThread) return false;
    void client.request({ threadId: tab.automationThread, tabId: id, command })
      .catch(() => { void message.error({ content: uiText('market.browserFailed'),
        style: { maxWidth: 400, marginInline: 'auto' } }); });
    return true;
  }, [client]);
  const reset = useCallback(() => {
    sources.current.clear(); requests.current.clear(); setState(emptyState());
  }, []);
  const pageNavigate = useCallback((id: string, url: string) => {
    if (!pageUrl(url)) return;
    setState(current => ({ ...current, tabs: current.tabs.map(tab => tab.id === id
      ? { ...navigateTab(tab, url), title: pageTitle(url) } : tab) }));
  }, []);
  const navigate = useCallback(async (id: string, url: string, resolved = false) => {
    if (!pageUrl(url)) return;
    if (managedCommand(id, { action: 'navigate', url })) return;
    const request = Symbol(); requests.current.set(id, request);
    try {
      const address = environment && !resolved ? await environment.resolveWebsite(url) : url;
      if (requests.current.get(id) === request) pageNavigate(id, address);
    } catch {
      if (requests.current.get(id) === request) void message.error({
        content: uiText('client.conversation.couldNotOpenTheLinkPleaseTryAgainShortly'),
        style: { maxWidth: 400, marginInline: 'auto' },
      });
    } finally {
      if (requests.current.get(id) === request) requests.current.delete(id);
    }
  }, [environment, pageNavigate, managedCommand]);
  const add = useCallback((url = '', resolved = false) => {
    const tab = { ...createBrowserTab(), title: pageTitle(url) };
    setState(current => ({ ...current, tabs: [...current.tabs, tab], activeId: tab.id }));
    if (url) void navigate(tab.id, url, resolved);
    return tab.id;
  }, [navigate]);
  const open = useCallback((url: string, resolved = false) => {
    if (!pageUrl(url)) return;
    const source = `${resolved}:${url}`;
    const existing = sources.current.get(source);
    if (existing) { setState(current => ({ ...current, activeId: existing })); return; }
    sources.current.set(source, add(url, resolved));
  }, [add]);
  const remove = useCallback((id: string) => {
    requests.current.delete(id);
    sources.current.forEach((value, key) => { if (value === id) sources.current.delete(key); });
    setState(current => {
      const index = current.tabs.findIndex(tab => tab.id === id);
      const tabs = current.tabs.filter(tab => tab.id !== id);
      const commands = { ...current.commands }; delete commands[id];
      const activeId = current.activeId === id ? (tabs[Math.max(0, index - 1)]?.id ?? '') : current.activeId;
      return { tabs, activeId, commands };
    });
  }, []);
  const close = useCallback((id: string) => {
    managedCommand(id, { action: 'close' }); remove(id);
  }, [managedCommand, remove]);
  const action = useCallback((id: string, action: BrowserAction) => {
    if (managedCommand(id, { action })) return;
    if (!isTauri() && action !== 'reload') {
      setState(current => ({ ...current, tabs: current.tabs.map(tab => {
        if (tab.id !== id) return tab;
        const next = moveTab(tab, action === 'back' ? -1 : 1);
        return { ...next, title: pageTitle(next.url) };
      }) }));
      return;
    }
    const command = { action, sequence: ++sequence.current };
    setState(current => ({ ...current, commands: { ...current.commands, [id]: command } }));
  }, [managedCommand]);
  const adopt = useCallback((tab: ManagedBrowserTab) => {
    setState(current => ({ ...current, activeId: tab.id, tabs: current.tabs.some(entry => entry.id === tab.id)
      ? current.tabs : [...current.tabs, { ...createBrowserTab(), ...tab,
        title: pageTitle(tab.url), automationThread: tab.threadId }] }));
  }, []);
  return { ...state, open, reset, adopt, remove, onCloseTab: close, onNewTab: () => add(),
    onSelect: (activeId: string) => setState(current => ({ ...current, activeId })),
    onNavigate: (id: string, url: string) => { void navigate(id, url); }, onPageNavigate: pageNavigate,
    onPopup: (_id: string, url: string) => { if (pageUrl(url)) add(url, true); }, onAction: action };
}
