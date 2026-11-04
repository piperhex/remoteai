import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { DetailsWorkspace } from '../../../shared/conversation/DetailsWorkspace';
import { LocalProjectBrowser } from '../src/pages/codexGui/LocalProjectBrowser';
import { ProjectBrowserButton } from '../../../shared/project-browser/views/ProjectBrowserButton';
import { ChatTools } from '../../web/src/chat/ChatTools';
import { createGuiToolsClient } from '../../../shared/remote-chat/guiTools';
import type { ProjectBrowserRequest } from '../../../shared/project-browser/protocol';
import { guiApi } from '../../../shared/conversation/api';
import { displayText } from '../../../shared/localization/uiText';
import { applyThemeMode } from '../src/utils/themeMode';
import { browserRoot, savedFiles, causeConflict, seedLargeDirectory,
  seedLargeText } from './project-browser-fixture';
import { ProjectBrowser } from '../../../shared/project-browser/ProjectBrowser';
import type { BrowserHost } from '../../../shared/project-browser/entryActions';
import { ChatFileReferencesProvider, useComposerFileReferences } from '../../../shared/chat/ChatFileReferences';
import type { ReplyQuote } from '../../../shared/conversation/replyQuotes';
import { ChatDetailsWorkspace } from '../../../shared/remote-chat/views/ChatDetailsWorkspace';
import '../src/styles.css';
import 'antd/dist/reset.css';
import { previewBrowserRequest, setPreviewFiles, previewReads } from './browser-preview-fixture';

const params = new URLSearchParams(location.search);
const dark = params.has('dark');
const mode = params.get('mode') ?? 'local';
if (params.has('largeDirectory')) seedLargeDirectory(10_001);
if (params.has('largeText')) seedLargeText(params.has('atThreshold'));
function fixtureRequest<T>(request: object): Promise<T> {
  const operation = (request as ProjectBrowserRequest).operation;
  if (params.has('editorService') && ['projectFileRead', 'projectFileWrite'].includes(operation)) {
    return (window as unknown as { projectEditorService: (request: object) => Promise<T> }).projectEditorService(request);
  }
  return previewBrowserRequest<T>(request as ProjectBrowserRequest);
}
const client = createGuiToolsClient(fixtureRequest);
guiApi.request = fixtureRequest;
Object.assign(window, { savedFiles, causeConflict, setPreviewFiles, previewReads });
const browserActions: { path: string; action: string }[] = [];
const fixtureHost: BrowserHost = {
  copyPath: async path => { browserActions.push({ path, action: 'copyPath' }); },
  open: async entry => { browserActions.push({ path: entry.path, action: 'explorer' }); },
  openTerminal: entry => { browserActions.push({ path: entry.path, action: 'terminal' }); },
};
Object.assign(window, { browserActions });
applyThemeMode(dark ? 'dark' : 'light');
document.body.style.minWidth = '0';
localStorage.setItem('codex-switch:language', 'zh');
localStorage.setItem('codex-switch:gui-details-width', '960');

function QuoteComposer() {
  const [quotes, setQuotes] = useState<ReplyQuote[]>([]);
  const input = useRef<HTMLTextAreaElement>(null);
  useComposerFileReferences({ scope: 'fixture', enabled: true, add: () => true,
    addQuote: quote => { setQuotes(current => [...current, quote]); return true; },
    focus: () => input.current?.focus() });
  return <div>{quotes.map((quote, index) => <pre data-testid="quote" key={index}>{quote.text}</pre>)}
    <textarea ref={input} aria-label="聊天输入框" defaultValue="原有草稿" /></div>;
}

function App() {
  const [isDark, setDark] = useState(dark);
  const [connected, setConnected] = useState(true);
  const [project, setProject] = useState(browserRoot);
  const Workspace = mode === 'web' || mode === 'mobile' ? ChatDetailsWorkspace : DetailsWorkspace;
  if (mode === 'standalone') return <div style={{ height: '100dvh' }}>
    <ProjectBrowser client={client.projectBrowser} cwd={project} connected={connected} t={displayText}
      host={fixtureHost} onClose={() => {}} preferences={{ delay: 0, change: () => {} }} />
  </div>;
  return <ConfigProvider theme={{ algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
    <div style={{ height: '100dvh', background: isDark ? '#121614' : '#f5f8f6' }}>
      <ChatFileReferencesProvider><Workspace selected={null} active enabled>
        <QuoteComposer />
        <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
          <span>聊天</span>
          {mode === 'local' && <LocalProjectBrowser cwd={project} active connected={connected} />}
          {(mode === 'remote' || mode === 'web') && <ProjectBrowserButton client={client.projectBrowser} cwd="D:/remote"
            active connected={connected} />}
          {mode === 'mobile' && <ChatTools client={client} cwd={browserRoot} active connected={connected} />}
          <button type="button" onClick={() => setConnected(value => !value)}>切换连接</button>
          <button type="button" onClick={() => {
            applyThemeMode(isDark ? 'light' : 'dark'); setDark(!isDark);
          }}>切换主题</button>
          <button type="button" onClick={() => setProject(value => value === browserRoot ? 'C:/other' : browserRoot)}>
            切换项目</button>
        </div>
      </Workspace></ChatFileReferencesProvider>
    </div>
  </ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<App />);
