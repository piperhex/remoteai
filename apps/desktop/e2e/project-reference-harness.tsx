import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { installBrowserDefaultsGuard } from '../../../shared/browser/installBrowserDefaultsGuard';
import { setThemeMode } from '../../web/src/theme/preference';
import { ChatFileReferencesProvider } from '../../../shared/chat/ChatFileReferences';
import { DetailsWorkspace } from '../../../shared/conversation/DetailsWorkspace';
import { Composer } from '../src/pages/codexGui/Composer';
import { GuiController } from '../src/pages/codexGui/controller';
import { guiApi } from '../../../shared/conversation/api';
import { testModels } from '../../../shared/conversation/testing/models';
import { ChatComposer } from '../../../shared/remote-chat/views/ChatComposer';
import { ChatTools } from '../../web/src/chat/ChatTools';
import { ProjectBrowserButton } from '../../../shared/project-browser/views/ProjectBrowserButton';
import { createGuiToolsClient } from '../../../shared/remote-chat/guiTools';
import type { ProjectBrowserRequest } from '../../../shared/project-browser/protocol';
import type { ComposerProps } from '../../../shared/remote-chat/views/composerProps';
import { browserRequest } from './project-browser-fixture';
import 'antd/dist/reset.css';
import '../../web/src/styles.css';
import '../src/styles.css';

const mode = new URLSearchParams(location.search).get('mode') ?? 'local';
const dark = new URLSearchParams(location.search).has('dark');
installBrowserDefaultsGuard();
const cwd = mode === 'local' ? 'C:/project' : 'D:/remote';
const client = createGuiToolsClient(<T,>(request: object) => browserRequest<T>(request as ProjectBrowserRequest));
guiApi.request = <T,>(request: object) => browserRequest<T>(request as ProjectBrowserRequest);
const controller = new GuiController();
const state = { ...controller.getSnapshot(), connection: 'ready' as const, models: testModels,
  settings: { ...controller.getSnapshot().settings, cwd, model: 'gpt-test' } };
controller.send = async (text, images, skills, attachments) => {
  document.body.dataset.sent = JSON.stringify({ text, images, skills, attachments }); return true;
};
const noop = () => {};
const remote: ComposerProps = {
  models: testModels, selection: { model: 'gpt-test', effort: 'high', access: 'workspace-write' },
  threadId: 'remote', cwd, active: true, ready: true, sending: false, running: false,
  settingsBusy: false, settingsError: '', compacting: false, compactReason: null,
  updateSettings: async () => {}, refreshModels: async () => {}, interrupt: async () => {}, compact: async () => true,
  goals: { load: async () => {}, clear: async () => true },
  contextSettings: { read: async () => ({ capacity: null }), write: async (_id, value) => value },
  catalog: { skills: [], loaded: true, loading: false, error: '', refresh: noop },
  loadFiles: async request => client.projectBrowser.list(cwd, request.directory),
  loadCatalog: async () => ({ data: [], plugins: [] }), loadConversations: async () => ({ data: [], nextCursor: null }),
  readUsage: async () => ({ totalTokens: 0, estimatedCostUsd: 0, primaryRemainingPercent: null,
    primaryRemainingAggregated: false, providerEstimatedCost: null }),
  readConversationMetrics: async () => ({ totalOutputTokens: 0, totalOutputTimeMs: 0, outputRequestCount: 0 }),
  connection: { deviceName: '测试电脑', chooseDevice: noop, client: {
    read: async () => ({ running: true, choices: [], selection: { kind: 'none' } }),
    select: async selection => selection, subscribe: () => noop,
  } },
  send: async input => { document.body.dataset.sent = JSON.stringify(input); return true; },
};
localStorage.setItem('codex-switch:language', 'zh');
setThemeMode(dark ? 'dark' : 'light');
document.body.style.minWidth = '0';

function Harness() {
  return <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
    <main style={{ height: '100dvh' }}>
    <DetailsWorkspace selected={null} active>
      <ChatFileReferencesProvider>
        {mode === 'local' ? <Composer state={state} controller={controller} active /> : <>
          {mode === 'phone' ? <ChatTools client={client} cwd={cwd} active connected />
            : <ProjectBrowserButton client={client.projectBrowser} cwd={cwd} active connected
              desktopStyle={mode === 'remote'} />}
          <ChatComposer {...remote} />
        </>}
      </ChatFileReferencesProvider>
    </DetailsWorkspace>
  </main></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
