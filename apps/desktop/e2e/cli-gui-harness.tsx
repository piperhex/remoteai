import { useSyncExternalStore } from 'react';
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
import { createCliGuiFixture } from './cli-gui-fixture';
import { RemoteAccountPicker } from '../../../shared/conversation/remote/RemoteAccountPicker';
import { saveProject } from '../../../shared/conversation/projectCatalog';
import { applyThemeMode } from '../src/utils/themeMode';
import { setThemeMode } from '../../web/src/theme/preference';
import styles from '../../../shared/conversation/styles.module.less';
import 'antd/dist/reset.css';
import '../src/pages/codexGui/remote/remoteGui.less';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'local';
const dark = params.has('dark');
await (mode === 'web' ? import('../../web/src/styles.css') : import('../src/styles.css'));
(mode === 'web' ? setThemeMode : applyThemeMode)(dark ? 'dark' : 'light');
setInterfaceLanguage('zh');
saveGlobalFontSize(params.has('large') ? 20 : 14);
const fixture = createCliGuiFixture(!params.has('missing'));
saveProject({ path: 'F:/projects/remoteai', name: 'Remote AI' });
const controller = new ChatController(events => ({ start() { events.mode('direct'); events.ready(); }, stop() {},
  request: async <T>(method: string, value?: unknown): Promise<T> => {
    const body = value as { operation?: string } | undefined;
    if (method === 'connect') return [] as T;
    if (body?.operation === 'queueRead') return { revision: 0, threads: {} } as T;
    if (body?.operation === 'models') return { data: [{ id: 'codex-test', model: 'codex-test', displayName: 'GPT-6',
      isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [] }] } as T;
    return { data: [], nextCursor: null } as T;
  },
}));
controller.cliGui.request = fixture.transport.request;
controller.cliGui.subscribe = fixture.transport.subscribe;
controller.cliGui.subscribeAccountChange = fixture.transport.subscribeAccountChange;
controller.guiTools.projects.list = async () => [{ cwd: 'F:/projects/remoteai', label: 'Remote AI' }];
const device = { deviceId: 'pc', name: 'Office PC', platform: 'Windows', online: true };
const t: Translate = (key, values) => translate('zh', key, values);

function Harness() {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const algorithm = dark ? theme.darkAlgorithm : theme.defaultAlgorithm;
  const accounts = <RemoteAccountPicker client={fixture.accounts} ready active privacyMode={false}
    computers={{ current: mode === 'local' ? null : device, devices: [device], allowLocal: true,
      authenticated: true, loading: false, error: '', refresh() {}, login() {}, choose() {} }} />;
  return <ApplicationTypography><ConfigProvider theme={{ algorithm: mode === 'web' ? algorithm
    : [algorithm, theme.compactAlgorithm], token: { colorPrimary: '#28837f',
      fontFamily: mode === 'web' ? "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif"
        : '"DM Sans", "Microsoft YaHei UI", sans-serif' } }}><App>
    <main className={mode === 'remote' ? `${styles.page} chat-page gui-remote-workspace`
      : mode === 'web' ? 'chat-page' : ''} style={{ height: '100dvh' }}>
      {mode === 'local' ? <CodexGuiPage active accountPicker={accounts} providers={[]} aggregateApis={[]}
        plugins={{ authenticated: false, onLogin() {}, notify() {}, t }} />
        : <ConnectedChat chat={{ state, controller, foreground: true }} device={device} devices={[device]}
          active scope={`cli-test-${mode}`} email="test@example.test" chooseDevice={() => {}} cliVersion="0.150.0"
          accountPicker={accounts}
          renderSidebar={mode === 'remote' ? actions => <RemoteGuiSidebar state={state} controller={controller}
            actions={actions} accountPicker={accounts} focusMode={{ focused: false, onToggleFocus() {} }} /> : undefined} />}
    </main>
  </App></ConfigProvider></ApplicationTypography>;
}
if (mode !== 'local') controller.start();
Object.assign(window, { cliFixture: fixture, setCliLanguage: setInterfaceLanguage });
createRoot(document.getElementById('root')!).render(<Harness />);
