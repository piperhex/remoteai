import { ExternalLink } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { message } from 'antd';
import { BrowserContents } from '../../../../../../shared/provider-market/ProviderBrowser';
import { BrowserResourcesContext, ResourceBrowserSurface } from './browserResources';
import { guiLanguage, uiText } from '../../../i18n/uiText';
import { CopyButton } from '../CopyButton';
import { PreviewNavigation, type PreviewNavigationState } from './PreviewNavigation';
import type { useWebsiteTabs } from './useWebsiteTabs';
import './websitePreview.css';

export function WebsitePreview(props: {
  browser: ReturnType<typeof useWebsiteTabs>; active: boolean; resizing: boolean;
  navigation?: PreviewNavigationState; expanded: boolean; toggleExpanded: () => void; onClose: () => void;
}) {
  const browser = props.browser;
  const url = browser.tabs.find(tab => tab.id === browser.activeId)?.url ?? '';
  const externalUrl = /^https?:\/\//i.test(url) ? url : '';
  const openBrowser = () => {
    if (!externalUrl) return;
    if (!isTauri()) { window.open(url, '_blank', 'noopener,noreferrer'); return; }
    void openUrl(url).catch(() => { void message.error({
      content: uiText('client.conversation.couldNotOpenTheLinkPleaseTryAgainShortly'),
      style: { maxWidth: 400, marginInline: 'auto' },
    }); });
  };
  return <section className="pm-browser website-preview-browser" aria-label={uiText('client.workspaceActions.webPreview')}>
    <BrowserResourcesContext.Provider value={browser.resources}>
    <BrowserContents {...browser} embedded language={guiLanguage()} open={props.active && !props.resizing}
      Surface={ResourceBrowserSurface} fullscreen={props.expanded} toggleFullscreen={props.toggleExpanded}
      onClose={props.onClose} onCloseTab={id => {
        browser.onCloseTab(id); if (browser.tabs.length === 1) props.onClose();
      }} history={props.navigation && (props.navigation.canGoBack || props.navigation.canGoForward)
        ? <PreviewNavigation navigation={props.navigation} /> : undefined}
      actions={<><CopyButton text={url} label={uiText('client.mobile.copyLink')} />
        <button type="button" aria-label={uiText('client.workspaceActions.openInBrowser')} disabled={!externalUrl}
          title={uiText('client.workspaceActions.openInBrowser')} onClick={openBrowser}><ExternalLink size={16} /></button></>} />
    </BrowserResourcesContext.Provider>
  </section>;
}
