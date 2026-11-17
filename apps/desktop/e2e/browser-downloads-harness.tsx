import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { BrowserPage } from '../../../shared/browser/BrowserPage';
import { BookmarkProvider } from '../../../shared/browser/bookmarks/context';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { setGuiLanguage } from '../../../shared/localization/uiText';
import { DownloadWorkspace } from '../../../shared/downloads/desktop/DownloadWorkspace';
import { useDownloadTasks } from '../../../shared/downloads/useDownloadTasks';
import { useBrowserDownloads } from '../src/downloads/useBrowserDownloads';
import { LOCAL_DOWNLOAD_OWNER } from '../src/downloads/localGitDownloads';
import { DownloadNavigationIcon } from '../src/downloads/DownloadNavigationIcon';
import { DownloadManagerPage } from '../../web/src/downloads/DownloadManagerPage';
import { downloadManager } from '../../../shared/downloads/manager';
import '../../../shared/downloads/styles.css';
import '../src/styles.css';
import 'antd/dist/reset.css';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'local';
const dark = params.has('dark');
setGuiLanguage('zh');
localStorage.setItem('codex-switch:global-font-size', params.get('font') ?? '14');
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
declare global { interface Window { clearBrowserDownloadFixture: () => Promise<void> } }
window.clearBrowserDownloadFixture = async () => {
  await downloadManager.initialize();
  for (const task of downloadManager.snapshot()) await downloadManager.remove(task.id);
};

function Harness() {
  const downloadMessages = useBrowserDownloads();
  const [downloads, setDownloads] = useState(params.has('downloads'));
  const { tasks, busy, error, run, removeTasks } = useDownloadTasks(LOCAL_DOWNLOAD_OWNER,
    { confirmRemove: async () => true });
  return <ApplicationTypography><ConfigProvider theme={{ algorithm: [dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    ...(mode === 'web' ? [] : [theme.compactAlgorithm])] }}>
    <BookmarkProvider scope={`browser-downloads-${mode}`}>
      {downloadMessages}
      <div style={{ height: '100vh', display: 'flex', background: dark ? '#151b25' : '#f4f7fa',
        color: dark ? '#e5e9f0' : '#182230' }}>
        <aside style={{ width: 170, padding: 16, flexShrink: 0 }}><h3>Remote AI</h3>
          <p>{mode}</p><button onClick={() => setDownloads(false)}>浏览器</button>
          <button aria-label="下载管理" onClick={() => setDownloads(true)}><DownloadNavigationIcon owner={LOCAL_DOWNLOAD_OWNER} />下载管理</button>
        </aside>
        <main style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'auto' }}>
          <div style={{ height: downloads ? 0 : '100%', overflow: 'hidden' }}>
            <BrowserPage language="zh" active={!downloads} onClose={() => {}} /></div>
          {downloads && (mode === 'web'
            ? <DownloadManagerPage owner={LOCAL_DOWNLOAD_OWNER} onBack={() => setDownloads(false)} />
            : <DownloadWorkspace tasks={tasks} owner={LOCAL_DOWNLOAD_OWNER} busy={!!busy} error={error}
              run={run} removeTasks={removeTasks} allowReveal />)}
        </main>
      </div>
    </BookmarkProvider>
  </ConfigProvider></ApplicationTypography>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
