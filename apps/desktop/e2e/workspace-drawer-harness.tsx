import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { repositoryFixture } from './git-repositories-fixture';
import { largeGitFixture } from './git-large-fixture';
import { useContext, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { DetailsWorkspace } from '../../../shared/conversation/DetailsWorkspace';
import { DetailsContext } from '../../../shared/conversation/detailsContext';
import { ConversationChangesButton } from '../../../shared/conversation/ConversationChangesButton';
import { GuiToolbox } from '../../../shared/conversation/GuiToolbox';
import { filePreviewApi } from '../../../shared/file-preview/workspace/api';
import { useThemeMode } from '../src/hooks/useThemeMode';
import { ChatDetailsWorkspace } from '../../../shared/remote-chat/views/ChatDetailsWorkspace';
import { ChatFileContext } from '../../../shared/remote-chat/views/ChatFileLink';
import type { FilePreviewContext } from '../../../shared/remote-chat/views/ChatFilePreview';
import { ChatTools } from '../../web/src/chat/ChatTools';
import { ChatTerminal } from '../../web/src/chat/ChatTerminal';
import { ChatTerminalLayout } from '../../../shared/remote-chat/views/ChatTerminalLayout';
import { ProjectBrowserButton } from '../../../shared/project-browser/views/ProjectBrowserButton';
import { AdaptiveSheet } from '../../../shared/layout/AdaptiveSheet';
import { WorkspaceDrawerContext } from '../../../shared/chat/workspaceDrawer';
import { createGuiToolsClient } from '../../../shared/remote-chat/guiTools';
import { createAsyncGitFixture } from '../../../shared/remote-chat/testing/gitFixture';
import { browserRequest, browserRoot } from './project-browser-fixture';
import type { ProjectBrowserRequest } from '../../../shared/project-browser/protocol';
import type { TerminalInfo } from '../../../shared/terminal/types';
import '../src/styles.css';
import '../../../shared/git/views/git.css';
import '../../../shared/remote-chat/views/chat.css';
import 'antd/dist/reset.css';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'local';
const dark = params.has('dark');
const changes = { turns: [{ id: 'edit', status: 'completed', items: [],
  diff: 'diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -1 +1 @@\n-old\n+updated\n' }] };
const client = createGuiToolsClient(<T,>(request: object) => browserRequest<T>(request as ProjectBrowserRequest));
if (params.has('toolLifecycle')) client.desktop.open = () => new Promise(() => undefined);
client.git = params.has('submodules') ? repositoryFixture(browserRoot) : createAsyncGitFixture();
if (params.has('largeGit')) client.git = largeGitFixture();
if (params.has('font')) localStorage.setItem('codex-switch:global-font-size', params.get('font')!);
let gitReads = 0;
const readChanges = client.git.changes;
client.git.changes = async cwd => { document.body.dataset.gitReads = String(++gitReads); return readChanges(cwd); };
let terminalOpens = 0;
let terminalSessions: TerminalInfo[] = [];
client.terminal.list = async cwd => terminalSessions.filter(session => session.cwd === cwd);
client.terminal.open = async cwd => {
  document.body.dataset.terminalOpens = String(++terminalOpens);
  const session = { id: `retained-terminal-${terminalOpens}`, cwd, shell: 'bash' };
  terminalSessions.push(session);
  return session;
};
client.terminal.read = async () => ({ found: true, cursor: 0, truncated: false, events: [] });
client.terminal.resize = client.terminal.write = async () => {};
client.terminal.close = async id => { terminalSessions = terminalSessions.filter(session => session.id !== id); };
filePreviewApi.open = async target => ({ ...target, sessionId: 'preview', name: 'README.md',
  kind: 'markdown', text: '# Retained preview', url: '' });
filePreviewApi.close = async () => { document.body.dataset.previewClosed = 'true'; };
const remoteFiles: FilePreviewContext = {
  ready: true, threadId: 'thread', client: {
    open: async () => { throw new Error('Unexpected download'); },
    read: async () => { throw new Error('Unexpected download'); }, close: async () => {},
  }, load: async (_thread, path) => ({ path, text: '# Retained preview' }),
};
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
document.body.style.minWidth = '0';
localStorage.setItem('codex-switch:language', 'zh');

function Tools({ cwd, onProjectChange }: { cwd: string; onProjectChange: (cwd: string) => void }) {
  const details = useContext(DetailsContext)!;
  const workspace = useContext(WorkspaceDrawerContext)!;
  const [review, setReview] = useState(false);
  return <div style={{ padding: 20, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
    <span>对话</span><ConversationChangesButton value={params.has('changes') ? changes : undefined} />
    <select aria-label="Project" value={cwd} onChange={event => onProjectChange(event.target.value)}>
      <option value={browserRoot}>Project A</option><option value={`${browserRoot}/other`}>Project B</option>
    </select>
    <button onClick={() => { void (details.openRemoteFile ?? details.openFile)({
      path: 'C:/project/README.md', threadId: 'thread',
    }); }}>打开预览</button>
    <ProjectBrowserButton client={client.projectBrowser} cwd={cwd} connected active desktopStyle />
    {mode === 'web' ? <ChatTools client={client} cwd={cwd} connected active />
      : <GuiToolbox git={client.git} cwd={cwd} connected active trigger="git" />}
    <ChatTerminal client={client.terminal} cwd={cwd} active connected />
    <button onClick={() => { setReview(true); workspace.tabs.open('review'); }}>打开任务验收</button>
    {review && <AdaptiveSheet open title="任务验收" tabId="review" presentation="drawer" onClose={() => setReview(false)}>
      <textarea aria-label="验收草稿" defaultValue="" />
    </AdaptiveSheet>}
  </div>;
}
function App() {
  useThemeMode(dark ? 'dark' : 'light');
  const [cwd, setCwd] = useState(browserRoot);
  const tools = <ChatTerminalLayout><div style={{ flex: 1, minHeight: 0 }}>
    <Tools cwd={cwd} onProjectChange={setCwd} /></div></ChatTerminalLayout>;
  const content = mode === 'local' ? <DetailsWorkspace selected={cwd} active contentClassName="chat-diff-layout">
    {tools}</DetailsWorkspace>
    : <ChatFileContext.Provider value={remoteFiles}>
      <ChatDetailsWorkspace selected={cwd} active enabled={!params.has('toolLifecycle')}>{tools}</ChatDetailsWorkspace>
    </ChatFileContext.Provider>;
  const useTypography = params.has('submodules') || params.has('largeGit') || params.has('toolLifecycle');
  if (useTypography) return <ConfigProvider theme={{ algorithm: [
    dark ? theme.darkAlgorithm : theme.defaultAlgorithm, ...(mode === 'web' ? [] : [theme.compactAlgorithm]),
  ] }}><ApplicationTypography><div style={{ height: '100dvh' }}>{content}</div></ApplicationTypography></ConfigProvider>;
  return <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
    <div style={{ height: '100dvh' }}>{content}</div>
  </ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<App />);
