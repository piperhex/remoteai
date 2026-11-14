import { ExtensionMarketContext } from '../../../shared/browser/extensions/market';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { BrowserPage } from '../../../shared/browser/BrowserPage';
import { BrowserClientContext, localBrowserClient } from '../../../shared/file-preview/workspace/browserClient';
import type { BrowserClient, BrowserReply } from '../../../shared/browser/automation';
import type { BrowserExtension } from '../../../shared/browser/extensions/model';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { applyThemeColor, DEFAULT_THEME_COLOR } from '../../../shared/appearance/themeColor';
import { setGuiLanguage } from '../../../shared/localization/uiText';
import { marketText } from '../../../shared/provider-market/i18n';
import '../src/styles.css';
import 'antd/dist/reset.css';

const params = new URLSearchParams(location.search), mode = params.get('mode') ?? 'web';
const dark = params.has('dark'), native = params.has('native'), language = params.has('en') ? 'en' : 'zh';
setGuiLanguage(language);
localStorage.setItem('codex-switch:global-font-size', params.get('font') ?? '14');
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
applyThemeColor(DEFAULT_THEME_COLOR);
const t = marketText(language);
let entries: BrowserExtension[] = [{
  id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'Page marker', version: '1.0', enabled: true,
  pinned: false, popup: true, permissions: ['storage', 'http://127.0.0.1/*'],
}, {
  id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', name: 'A longer extension name to verify wrapping and toolbar layout',
  version: '2.0', enabled: false, pinned: false, popup: false, permissions: [],
}];
const client: BrowserClient = native ? { ...localBrowserClient, native: mode === 'local' } : {
  native: mode === 'local', subscribe: async () => () => {},
  browseFiles: async directory => {
    if (params.has('bridge')) {
      const reply = await fetch('http://127.0.0.1:1584/browse', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ directory, includeFiles: true }) });
      return reply.json();
    }
    return { directory, parent: directory ? '' : null, truncated: false,
      entries: directory ? [
        { name: 'Example extension', path: 'C:/Extensions/example', directory: true },
        { name: 'extension.zip', path: 'C:/Extensions/extension.zip', directory: false },
        { name: 'invalid.zip', path: 'invalid', directory: false },
      ] : [{ name: 'C:/', path: 'C:/', directory: true }] };
  },
  request: async input => {
    if (params.has('bridge')) {
      const reply = await fetch('http://127.0.0.1:1584/request', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      if (!reply.ok) throw new Error(await reply.text());
      return reply.json() as Promise<BrowserReply>;
    }
    if (input.command.action !== 'extensions') return { tabs: [] };
    const command = input.command.request;
    if (command.action === 'beginUpload') return { transfer: { token: 'test-transfer' } };
    if (command.action === 'writeUpload' || command.action === 'releaseTransfer') return {};
    if (command.action === 'discover') return { candidates: [{
      path: 'C:/Chrome/Default/Extensions/page-marker', profile: 'Default', name: 'Page marker',
      version: '1.0', permissions: ['storage', 'http://127.0.0.1/*'],
    }] };
    if (command.action === 'install' || command.action === 'finishUpload') {
      if (command.action === 'install' && command.path === 'invalid') throw new Error('market.extensionsInvalid');
      entries = [...entries, { id: 'cccccccccccccccccccccccccccccccc', name: 'Imported extension',
        version: '1.0', enabled: true, pinned: false, popup: true, permissions: [] }];
    }
    if (command.action === 'pin') entries = entries.map(entry => entry.id === command.id
      ? { ...entry, pinned: command.pinned } : entry);
    if (command.action === 'enable') entries = entries.map(entry => entry.id === command.id
      ? { ...entry, enabled: command.enabled } : entry);
    if (command.action === 'remove') entries = entries.filter(entry => entry.id !== command.id);
    return { supported: !params.has('unsupported'), entries };
  },
};
function Harness() {
  return <ApplicationTypography><ConfigProvider theme={{ algorithm: [dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    ...(mode === 'web' ? [] : [theme.compactAlgorithm])] }}>
    <BrowserClientContext.Provider value={client}>
      <div style={{ height: '100dvh', display: 'flex', background: dark ? '#151b25' : '#f4f7fa',
        color: dark ? '#e5e9f0' : '#182230' }} aria-label={t('market.browserTitle')}>
        <ExtensionMarketContext.Provider value={params.get('market') ?? location.origin}>
          <BrowserPage language={language} />
        </ExtensionMarketContext.Provider>
      </div>
    </BrowserClientContext.Provider>
  </ConfigProvider></ApplicationTypography>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
