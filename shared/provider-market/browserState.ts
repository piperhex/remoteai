import { pageUrl, resolvedPageUrl, type ProviderMarketSource } from './pageLink';

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  headerOrigin: string;
  headers: Record<string, string>;
  history: string[];
  historyIndex: number;
  /** Present only for conversation-owned tabs controlled by the built-in browser tools. */
  automationThread?: string;
}
export type BrowserAction = 'back' | 'forward' | 'reload';

export function createBrowserTab(source?: { name: string; marketSource: ProviderMarketSource }): BrowserTab {
  const url = source ? resolvedPageUrl(source.marketSource.page) : '';
  return { id: crypto.randomUUID(), title: source?.name ?? '', url,
    headerOrigin: url ? new URL(url).origin : '', headers: { ...source?.marketSource.page.headers },
    history: url ? [url] : [], historyIndex: url ? 0 : -1 };
}

export function navigateTab(tab: BrowserTab, url: string): BrowserTab {
  if (!pageUrl(url) || tab.url === url) return tab;
  const history = [...tab.history.slice(0, tab.historyIndex + 1), url];
  return { ...tab, url, history, historyIndex: history.length - 1 };
}

export function moveTab(tab: BrowserTab, direction: -1 | 1): BrowserTab {
  const historyIndex = Math.max(0, Math.min(tab.history.length - 1, tab.historyIndex + direction));
  return { ...tab, historyIndex, url: tab.history[historyIndex] ?? '' };
}
