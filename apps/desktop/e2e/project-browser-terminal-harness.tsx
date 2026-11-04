import { type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import { TerminalWorkspaceProvider } from '../../../shared/terminal/TerminalWorkspaceProvider';
import { useRemoteTerminalPanel } from '../../../shared/remote-chat/useRemoteTerminalPanel';
import { useRemoteTerminalLauncher } from '../../../shared/remote-chat/useRemoteTerminalLauncher';
import { createGuiToolsClient } from '../../../shared/remote-chat/guiTools';
import { remoteTerminalApi } from '../../../shared/remote-chat/terminalApi';
import type { ProjectBrowserRequest } from '../../../shared/project-browser/protocol';
import { ProjectBrowserButton } from '../../../shared/project-browser/views/ProjectBrowserButton';
import { ChatTerminal } from '../../web/src/chat/ChatTerminal';
import { ChatTerminalLayout } from '../../../shared/remote-chat/views/ChatTerminalLayout';
import { ChatDetailsWorkspace } from '../../../shared/remote-chat/views/ChatDetailsWorkspace';
import { RemoteTerminals } from '../src/remoteChat/terminals';
import { LocalProjectBrowser } from '../src/pages/codexGui/LocalProjectBrowser';
import { DetailsWorkspace } from '../../../shared/conversation/DetailsWorkspace';
import { useTerminalPanel, type TerminalPanelState } from '../../../shared/terminal/views/useTerminalPanel';
import TerminalPanel from '../../../shared/terminal/views/TerminalPanel';
import { terminalApi } from '../src/pages/codexGui/terminal/api';
import { fileApi } from '../../../shared/conversation/fileApi';
import { guiApi } from '../../../shared/conversation/api';
import { browserRequest, browserRoot, seedNpmScripts, seedLargeText, savedFiles } from './project-browser-fixture';
import '../src/styles.css';
import '../../../shared/remote-chat/views/chat.css';
import 'antd/dist/reset.css';

const mode = new URLSearchParams(location.search).get('mode') ?? 'local';
localStorage.setItem('codex-switch:language', 'zh');
document.body.style.minWidth = '0';
let opens = 0;
if (new URLSearchParams(location.search).has('scripts')) seedNpmScripts();
if (new URLSearchParams(location.search).has('large')) seedLargeText();
const scriptSessions = new Map<string, { name: string; receive: Parameters<typeof terminalApi.open>[2] }>();
window.addEventListener('npm-fixture-exit', () => {
  for (const session of scriptSessions.values()) session.receive({ type: 'exit', code: 0 });
  scriptSessions.clear();
});
terminalApi.open = async (cwd, _size, receive, options) => {
  const id = String(++opens);
  document.body.dataset.terminalOpens = String(opens);
  if (options?.npmScript === 'failStart') throw new Error('Fixture startup failure');
  if (options?.npmScript) {
    scriptSessions.set(id, { name: options.npmScript, receive });
    document.body.dataset.scriptCwd = cwd;
    document.body.dataset.savedBeforeRun = savedFiles.at(-1)?.text ?? '';
  }
  receive({ type: 'output', data: [...new TextEncoder().encode(`PS ${cwd}> `)] });
  return { id, cwd, shell: 'PowerShell', ...options };
};
terminalApi.write = terminalApi.resize = async () => {};
terminalApi.close = async id => {
  scriptSessions.get(id)?.receive({ type: 'exit', code: 0 });
  scriptSessions.delete(id);
  document.body.dataset.terminalCloses = String(Number(document.body.dataset.terminalCloses ?? 0) + 1);
};
fileApi.perform = async () => { throw new Error('Unexpected system application launch'); };
guiApi.request = <T,>(request: object) => browserRequest<T>(request as ProjectBrowserRequest);
const terminals = new RemoteTerminals();
const client = createGuiToolsClient(<T,>(request: object) => {
  const body = request as Record<string, unknown>;
  return String(body.operation).startsWith('guiTerminal')
    ? terminals.request(body, 'fixture') as Promise<T> : browserRequest<T>(request as ProjectBrowserRequest);
});
const remoteApi = remoteTerminalApi(client.terminal);

function Layout({ panel, children }: { panel: TerminalPanelState; children: ReactNode }) {
  const Workspace = mode === 'local' ? DetailsWorkspace : ChatDetailsWorkspace;
  return <TerminalWorkspaceProvider panel={panel}>
    <Workspace selected="fixture" active enabled contentClassName="chat-diff-layout">
      <ChatTerminalLayout>
        <div style={{ flex: 1, minHeight: 0, padding: 20 }}>
          {mode === 'local' ? <LocalProjectBrowser cwd={browserRoot} connected active />
            : <ProjectBrowserButton client={client.projectBrowser} cwd={browserRoot} connected active />}
          <p>Conversation</p><textarea aria-label="Chat input" />
        </div>
        {children}
      </ChatTerminalLayout>
    </Workspace>
  </TerminalWorkspaceProvider>;
}

function Local() {
  const panel = useTerminalPanel(browserRoot);
  return <Layout panel={panel}>{panel.tabs.length > 0 &&
    <TerminalPanel panel={panel} api={terminalApi} active notice={panel.error} />}</Layout>;
}

function Remote() {
  const panel = useRemoteTerminalPanel({ client: client.terminal, cwd: browserRoot, connected: true });
  return <Layout panel={panel}>{(panel.open || panel.tabs.length > 0) &&
    <TerminalPanel panel={panel} api={remoteApi} active notice={panel.error} />}</Layout>;
}

function Web() {
  const panel = useRemoteTerminalLauncher({ client: client.terminal, cwd: browserRoot, connected: true });
  return <Layout panel={panel}>
    <ChatTerminal panel={panel} client={client.terminal} cwd={browserRoot} active connected hideTrigger />
  </Layout>;
}

createRoot(document.getElementById('root')!).render(<ConfigProvider>
  <div style={{ height: '100dvh' }}>{mode === 'local' ? <Local /> : mode === 'remote' ? <Remote /> : <Web />}</div>
</ConfigProvider>);
