import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, Modal, theme } from 'antd';
import { DetailsWorkspace } from '../../../shared/conversation/DetailsWorkspace';
import { ChatDetailsWorkspace } from '../../../shared/remote-chat/views/ChatDetailsWorkspace';
import { MessageLink } from '../../../shared/conversation/MessageLink';
import { ChatMarkdown } from '../../../shared/remote-chat/views/ChatMarkdown';
import { FileEnvironmentContext, type FileEnvironment } from '../../../shared/conversation/fileEnvironment';
import { useThemeMode } from '../src/hooks/useThemeMode';
import { setGuiLanguage } from '../../../shared/localization/uiText';
import { BrowserClientContext, localBrowserClient } from '../../../shared/file-preview/workspace/browserClient';
import type { BrowserClient } from '../../../shared/browser/automation';
import '../src/styles.css';
import 'antd/dist/reset.css';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'local';
const origin = params.get('origin') ?? location.origin;
localStorage.setItem('codex-switch:theme-mode', params.has('dark') ? 'dark' : 'light');
setGuiLanguage(params.get('language') === 'en' ? 'en' : 'zh');
const urls = ['guide', 'dashboard', 'help'].map(name => `${origin}/preview-site/${name}`);
const automationClient: BrowserClient = { native: false,
  request: async request => {
    const response = await fetch('http://127.0.0.1:1554/request', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  }, subscribe: async () => () => {},
};

function Harness() {
  const { mode: appearance } = useThemeMode();
  const [dialog, setDialog] = useState(false);
  const [thread, setThread] = useState('preview-thread');
  const environment = useMemo<FileEnvironment>(() => ({ remote: true,
    previews: { open: async () => null, close: async () => {} },
    actions: { applications: async () => [], perform: async target => ({ path: target.path, saved: false }) },
    resolveWebsite: async url => url, image: () => null,
  }), []);
  const children = <main style={{ padding: 24, maxWidth: 560 }}>
    <h1>网页预览</h1><p>在对话中打开多个页面，随时切换查看。</p>
    {mode === 'local' ? urls.map((url, index) => <p key={url}>
      <MessageLink href={url}>{['使用指南', '项目概览', '帮助中心'][index]}</MessageLink></p>)
      : <ChatMarkdown text={`[使用指南](${urls[0]})\n\n[项目概览](${urls[1]})\n\n[帮助中心](${urls[2]})`} />}
    <button onClick={() => setDialog(true)}>打开对话框</button>
    <button onClick={() => setThread('another-thread')}>切换会话</button>
    <Modal open={dialog} onCancel={() => setDialog(false)} onOk={() => setDialog(false)} title="对话框">
      <p>浏览期间仍可操作界面。</p>
    </Modal>
  </main>;
  return <ConfigProvider theme={{ algorithm: appearance === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
    <BrowserClientContext.Provider value={params.has('automation') ? automationClient : localBrowserClient}>
    <FileEnvironmentContext.Provider value={mode === 'remote' ? environment : null}>
      <div style={{ height: '100vh' }}>{mode === 'local'
        ? <DetailsWorkspace selected={thread} active>{children}</DetailsWorkspace>
        : <ChatDetailsWorkspace selected={thread} active enabled>{children}</ChatDetailsWorkspace>}</div>
    </FileEnvironmentContext.Provider>
    </BrowserClientContext.Provider>
  </ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
