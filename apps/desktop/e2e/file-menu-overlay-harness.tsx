import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider, theme } from 'antd';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { applyThemeColor, DEFAULT_THEME_COLOR } from '../../../shared/appearance/themeColor';
import { BrowserOverlayProvider } from '../../../shared/browser/overlays/BrowserOverlayProvider';
import { FileMenu } from '../../../shared/conversation/FileMenu';
import { fileApi, FileThreadContext } from '../../../shared/conversation/fileApi';
import { FileEnvironmentContext, type FileEnvironment } from '../../../shared/conversation/fileEnvironment';
import { downloadBrowserResource } from '../../../shared/file-preview/workspace/downloadResource';
import { setGuiLanguage } from '../../../shared/localization/uiText';
import { createBrowserTab } from '../../../shared/provider-market/browserState';
import { marketText } from '../../../shared/provider-market/i18n';
import '../src/styles.css';
import 'antd/dist/reset.css';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'local', dark = params.has('dark');
setGuiLanguage('zh');
localStorage.setItem('codex-switch:global-font-size', params.get('font') ?? '14');
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
// The web host has no desktop shell minimum width.
if (mode === 'web') document.body.style.minWidth = '0';
applyThemeColor(DEFAULT_THEME_COLOR);
fileApi.applications = async () => [
  { id: 'vscode', name: 'VS Code', kind: 'editor' },
  { id: 'terminal', name: '终端', kind: 'terminal' },
  { id: 'other', name: '其他应用…', kind: 'system' },
];
const environment: FileEnvironment = { remote: true, actions: fileApi,
  previews: { open: async () => null, close: async () => {} },
  resolveWebsite: async url => url, image: () => null,
};
const resource = downloadBrowserResource({ path: 'C:/project/pda-build.exe', threadId: 'file-menu-fixture' });

function Harness() {
  const [result, setResult] = useState('');
  fileApi.perform = async (target, action) => {
    setResult(JSON.stringify({ target, action }));
    return { path: target.path, saved: false };
  };
  return <ApplicationTypography><ConfigProvider theme={{ algorithm: [
    dark ? theme.darkAlgorithm : theme.defaultAlgorithm, ...(mode === 'web' ? [] : [theme.compactAlgorithm]),
  ] }}><App><BrowserOverlayProvider>
    <FileEnvironmentContext.Provider value={mode === 'local' ? null : environment}>
      <FileThreadContext.Provider value="file-menu-fixture">
        <main style={{ height: '100vh', background: dark ? '#151b25' : '#f7f9f8',
          color: dark ? '#e5e9f0' : '#182230', padding: 24 }}>
          <p><FileMenu path="C:/project/report.pdf" line={12}>report.pdf</FileMenu></p>
          <output aria-label="操作结果">{result}</output>
          <div style={{ height: '65vh' }}>{resource.render({ tab: { ...createBrowserTab(), url: resource.url },
            active: true, command: null, t: marketText('zh'), onNavigate: () => {}, onPopup: () => {} })}</div>
        </main>
      </FileThreadContext.Provider>
    </FileEnvironmentContext.Provider>
  </BrowserOverlayProvider></App></ConfigProvider></ApplicationTypography>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
