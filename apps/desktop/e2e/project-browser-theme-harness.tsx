import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { DetailsWorkspace } from '../../../shared/conversation/DetailsWorkspace';
import { LocalProjectBrowser } from '../src/pages/codexGui/LocalProjectBrowser';
import { ChatDetailsWorkspace } from '../../../shared/remote-chat/views/ChatDetailsWorkspace';
import { ProjectBrowserButton } from '../../../shared/project-browser/views/ProjectBrowserButton';
import { setThemeMode } from '../../web/src/theme/preference';
import { applyThemeMode } from '../src/utils/themeMode';
import { guiApi } from '../../../shared/conversation/api';
import { createProjectBrowserClient, type ProjectBrowserRequest } from '../../../shared/project-browser/protocol';
import { browserRequest, browserRoot } from './project-browser-fixture';
import 'antd/dist/reset.css';
import '../src/styles.css';
import '../../../shared/remote-chat/views/chat.css';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'local';
const web = mode === 'web';
const request = <T,>(value: object) => browserRequest<T>(value as ProjectBrowserRequest);
guiApi.request = request;
const client = createProjectBrowserClient(request);
const Workspace = web ? ChatDetailsWorkspace : DetailsWorkspace;
const applyAppearance = web ? setThemeMode : applyThemeMode;
applyAppearance(params.has('dark') ? 'dark' : 'light');
localStorage.setItem('codex-switch:language', 'zh');
localStorage.setItem('codex-switch:gui-details-width', '960');

function Harness() {
  const [dark, setDark] = useState(params.has('dark'));
  return <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
    <div className={web ? 'chat-page' : undefined} style={{ height: '100dvh' }}>
      <Workspace selected={null} active enabled>
        <div style={{ padding: 16 }}>
          {mode === 'local' ? <LocalProjectBrowser cwd={browserRoot} active connected />
            : <ProjectBrowserButton client={client} cwd={browserRoot} active connected desktopStyle={!web} />}
          <button onClick={() => {
            applyAppearance(dark ? 'light' : 'dark'); setDark(!dark);
          }}>切换主题</button>
        </div>
      </Workspace>
    </div>
  </ConfigProvider>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
