import { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider, theme } from 'antd';
import { CodexGuiPage } from '../src/pages/CodexGuiPage';
import { ConnectedChat } from '../../../shared/remote-chat/views/ConnectedChat';
import { RemoteGuiSidebar } from '../src/pages/codexGui/remote/RemoteGuiSidebar';
import { ChatController } from '../../../shared/remote-chat/client/controller';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { saveGlobalFontSize } from '../../../shared/appearance/fontSize';
import { setInterfaceLanguage } from '../../../shared/localization/interfaceLanguage';
import { translate, type Translate } from '../src/i18n';
import { createCliGuiFixture, sidebarCodexThread, cliGitStatus } from './cli-gui-fixture';
import { RemoteAccountPicker } from '../../../shared/conversation/remote/RemoteAccountPicker';
import { saveProject } from '../../../shared/conversation/projectCatalog';
import { applyThemeMode } from '../src/utils/themeMode';
import { setThemeMode } from '../../web/src/theme/preference';
import styles from '../../../shared/conversation/styles.module.less';
import { RemoteGuiTools } from '../../../shared/conversation/remote/RemoteGuiTools';
import { RemoteGuiProject } from '../../../shared/conversation/remote/RemoteGuiProject';
import { useRemoteCliInstaller } from '../../../shared/conversation/remote/useRemoteCliInstaller';
import { getGuiController } from '../src/pages/codexGui/session';
import { runningFixtureThreads, runningFixtureSidebar } from './running-conversations-fixture';
import type { GuiEvent } from '../../../shared/conversation/types';
import { SIDEBAR_EVENT } from '../../../shared/remote-chat/sidebar';
import { historyDelta, type HistoryVersion } from '../../../shared/remote-chat/historySync';
import { saveGuiSkin } from '../src/pages/codexGui/guiSkin';
import { useDreamSkin } from '../src/pages/codexGui/useDreamSkin';
import { DashboardNavigation } from '../src/components/dashboard/DashboardNavigation';
import { useDesktopLayout } from '../../../shared/layout/useDesktopLayout';
import { ChatTools as WebChatTools } from '../../web/src/chat/ChatTools';
import { PrimaryPagePager } from '../../web/src/navigation/PrimaryPagePager';
import type { PrimaryPage } from '../../../shared/navigation/pageSwipe';
import 'antd/dist/reset.css';
import '../src/pages/codexGui/remote/remoteGui.less';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'local';
const dark = params.has('dark');
if (params.has('skin')) saveGuiSkin({ mode: 'custom', themeId: 'layout-fixture', overlayOpacity: 0.35 });
await (mode === 'web' ? import('../../web/src/styles.css') : import('../src/styles.css'));
(mode === 'web' ? setThemeMode : applyThemeMode)(dark ? 'dark' : 'light');
setInterfaceLanguage('zh');
saveGlobalFontSize(params.has('large') ? 20 : 14);
const fixture = createCliGuiFixture(!params.has('missing'), { manualInstall: params.has('progress') });
const modelRequests: unknown[] = [];
const runningThreads = params.has('running') ? runningFixtureThreads() : null;
let runningEvent: (event: GuiEvent) => void = () => {};
saveProject({ path: 'F:/projects/remoteai', name: 'Remote AI' });
const controller = new ChatController(events => ({ start() {
  runningEvent = events.event; events.mode('direct'); events.ready();
}, stop() {},
  request: async <T,>(method: string, value?: unknown): Promise<T> => {
    const body = value as { operation?: string; threadId?: string; known?: HistoryVersion; archived?: boolean } | undefined;
    if (method === 'connect') return [] as T;
    if (body?.operation === 'queueRead') return { revision: 0, threads: {} } as T;
    if (body?.operation === 'list') return {
      data: runningThreads ? (body.archived ? [] : runningThreads.slice(0, 3)) : [sidebarCodexThread],
      sidebar: runningThreads ? runningFixtureSidebar(runningThreads) : undefined, nextCursor: null } as T;
    if (body?.operation === 'read' || body?.operation === 'resume') return {
      thread: runningThreads?.find(thread => thread.id === body.threadId) ?? sidebarCodexThread } as T;
    if (body?.operation === 'syncHistory') return historyDelta(
      runningThreads?.find(thread => thread.id === body.threadId) ?? sidebarCodexThread, body.known) as T;
    if (body?.operation === 'models' || body?.operation === 'modelsRefresh') {
      modelRequests.push(body);
      return { data: fixture.models() } as T;
    }
    return { data: [], nextCursor: null } as T;
  },
}));
controller.cliGui.request = fixture.transport.request;
controller.cliGui.subscribe = fixture.transport.subscribe;
controller.cliGui.subscribeAccountChange = fixture.transport.subscribeAccountChange;
Object.assign(controller.guiAccounts, fixture.accounts);
controller.guiTools.projects.list = async () => [{ cwd: 'F:/projects/remoteai', label: 'Remote AI' }];
controller.guiTools.status = async () => ({ version: '0.150.0', installing: params.has('codex-progress'),
  release: params.has('codex-progress') ? { version: '0.151.0', size: 32 * 1024 * 1024 } : undefined,
  progress: params.has('codex-progress')
    ? { downloaded: 8 * 1024 * 1024, total: 32 * 1024 * 1024, phase: 'downloading' } : null, error: '' });
controller.guiTools.workspace = async request => cliGitStatus(request.cwd);
fixture.accounts.subscribe(() => { void controller.refreshModels(); });
const device = { deviceId: 'pc', name: 'Office PC', platform: 'Windows', online: true };
const t: Translate = (key, values) => translate('zh', key, values);

function Harness({ active = true }: { active?: boolean }) {
  const desktop = useDesktopLayout();
  const skinStyle = useDreamSkin(mode === 'remote');
  useEffect(() => {
    if (mode === 'local' && params.has('native')) void getGuiController().connect();
  }, []);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const installer = useRemoteCliInstaller(controller.guiTools, mode !== 'local');
  const algorithm = dark ? theme.darkAlgorithm : theme.defaultAlgorithm;
  const accounts = <RemoteAccountPicker client={fixture.accounts} ready active privacyMode={false}
    computers={{ current: mode === 'local' ? null : device, devices: [device], allowLocal: true,
      authenticated: true, loading: false, error: '', refresh() {}, login() {}, choose() {} }} />;
  return <ApplicationTypography><ConfigProvider theme={{ algorithm: mode === 'web' ? algorithm
    : [algorithm, theme.compactAlgorithm], token: { colorPrimary: '#28837f',
      fontFamily: mode === 'web' ? "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif"
        : '"DM Sans", "Microsoft YaHei UI", sans-serif' } }}><App>
    {params.has('hub') && mode !== 'web' && <DashboardNavigation page="codexGui" t={t} onPageChange={() => {}} />}
    <main className={mode === 'remote' ? `${styles.page} chat-page gui-remote-workspace`
      : mode === 'web' ? 'chat-page' : ''} data-dream-skin={skinStyle ? 'true' : undefined}
      style={{ height: params.has('hub') && mode !== 'web' ? 'calc(100dvh - 48px)' : '100dvh', ...skinStyle }}>
      {mode === 'local' ? <CodexGuiPage active accountPicker={accounts} providers={[]} aggregateApis={[]}
        plugins={{ authenticated: false, onLogin() {}, notify() {}, t }} />
        : <ConnectedChat chat={{ state, controller, foreground: true }} device={device} devices={[device]}
          active={active} scope={`cli-test-${mode}`} email="test@example.test" chooseDevice={() => {}} cliVersion="0.150.0"
          accountPicker={accounts}
          scrollableComposer={mode === 'remote'}
          headerActions={mode === 'web' && !desktop
            ? <WebChatTools client={controller.guiTools} active connected={state.ready}
              cwd={state.selected?.cwd ?? state.draftProject?.cwd ?? ''} deviceName={device.name} />
            : <RemoteGuiTools controller={controller} state={state} installer={installer} active />}
          composerHeader={(mode !== 'web' || desktop) && <RemoteGuiProject state={state} controller={controller} active computers={{
            current: device, devices: [device], allowLocal: false, authenticated: true,
            loading: false, error: '', refresh() {}, login() {}, choose() {},
          }} />}
          renderSidebar={mode === 'remote' ? actions => <RemoteGuiSidebar state={state} controller={controller}
            actions={actions} accountPicker={accounts} focusMode={{ focused: false, onToggleFocus() {} }} /> : undefined} />}
    </main>
  </App></ConfigProvider></ApplicationTypography>;
}
function MobilePages() {
  const [page, setPage] = useState<PrimaryPage>('chat');
  return <div className="main-content" style={{ height: '100dvh', display: 'flex' }}>
    <PrimaryPagePager page={page} onChange={setPage} pages={{ chat: <Harness active={page === 'chat'} />,
      accounts: <button onClick={() => setPage('chat')}>Return to chat</button>,
      discover: <div>Discover</div>, settings: <div>Settings</div> }} />
  </div>;
}
if (mode !== 'local') controller.start();
Object.assign(window, { cliFixture: fixture, cliModelRequests: modelRequests, setCliLanguage: setInterfaceLanguage });
if (runningThreads) Object.assign(window, {
  archiveRunningConversations: () => mode === 'local'
    ? getGuiController().filter('', true) : controller.list({ archived: true }),
  runningConversationArchived: () => mode === 'local'
    ? getGuiController().getSnapshot().archived : controller.snapshot().selectedArchived,
  finishRunningConversations: (count: number) => {
  runningThreads.slice(0, count).forEach(thread => {
    thread.status = { type: 'idle' };
    thread.turns = thread.turns!.map(turn => ({ ...turn, status: 'completed' }));
    runningEvent({ method: 'turn/completed', params: { threadId: thread.id, turn: thread.turns[0] } });
  });
  runningEvent({ method: SIDEBAR_EVENT, params: runningFixtureSidebar(runningThreads, 2) });
} });
createRoot(document.getElementById('root')!).render(params.has('swipe') ? <MobilePages /> : <Harness />);
