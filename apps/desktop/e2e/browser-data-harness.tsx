import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { BrowserPage } from '../../../shared/browser/BrowserPage';
import { BookmarkProvider } from '../../../shared/browser/bookmarks/context';
import { useBrowserData } from '../../../shared/browser/data/context';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { applyThemeColor, DEFAULT_THEME_COLOR } from '../../../shared/appearance/themeColor';
import { setGuiLanguage } from '../../../shared/localization/uiText';
import { desktopBrowserVaultKeyStorage } from '../src/api/browserVaultKey';
import '../src/styles.css';
import 'antd/dist/reset.css';

const params = new URLSearchParams(location.search), mode = params.get('mode') ?? 'web';
const dark = params.has('dark');
setGuiLanguage('zh');
localStorage.setItem('codex-switch:global-font-size', params.get('font') ?? '14');
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
applyThemeColor(DEFAULT_THEME_COLOR);
function Seed() {
  const { store, vault } = useBrowserData();
  useEffect(() => {
    if (store.snapshot().entries.length) { document.body.dataset.ready = 'true'; return; }
    const now = Date.now();
    for (const [index, title] of ['Remote AI 使用指南', '项目开发文档与常用工具', '网页测试页面', '昨天的浏览记录'].entries()) {
      store.visit({ id: `fixture-${index}`, kind: 'visit', title,
        url: `https://example.com/${index}`, at: now - (index === 3 ? 86400000 : index * 60000) });
    }
    void vault.unlock('browser-test-passphrase').then(async () => {
      vault.save({ origin: 'https://example.com', username: 'demo@example.com', password: 'fixture-only-secret' });
      await vault.lock(); document.body.dataset.ready = 'true';
    });
  }, [store, vault]);
  return null;
}
function Harness() {
  return <ApplicationTypography><ConfigProvider theme={{ algorithm: [dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    ...(mode === 'web' ? [] : [theme.compactAlgorithm])] }}>
    <BookmarkProvider scope={`browser-data-${mode}`} keyStorage={desktopBrowserVaultKeyStorage}><Seed />
      <div style={{ height: '100dvh', display: 'flex', background: dark ? '#151b25' : '#f4f7fa',
        color: dark ? '#e5e9f0' : '#182230' }}><BrowserPage language="zh" /></div>
    </BookmarkProvider>
  </ConfigProvider></ApplicationTypography>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
