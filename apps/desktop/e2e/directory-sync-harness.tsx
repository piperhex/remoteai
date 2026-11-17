import { useEffect, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider, theme } from 'antd';
import { ChatController } from '../../../shared/remote-chat/client/controller';
import { ConnectedChat } from '../../../shared/remote-chat/views/ConnectedChat';
import { RemoteGuiSidebar } from '../src/pages/codexGui/remote/RemoteGuiSidebar';
import { CodexGuiPage } from '../src/pages/CodexGuiPage';
import { getGuiController } from '../src/pages/codexGui/session';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { saveGlobalFontSize } from '../../../shared/appearance/fontSize';
import { setInterfaceLanguage } from '../../../shared/localization/interfaceLanguage';
import { createDirectoryFixture, directoryFixtureGrouping } from '../../../shared/testing/directoryFixture';
import { uiText } from '../../../shared/localization/uiText';
import { applyThemeMode } from '../src/utils/themeMode';
import { setThemeMode } from '../../web/src/theme/preference';
import styles from '../../../shared/conversation/styles.module.less';
import 'antd/dist/reset.css';
import '../src/pages/codexGui/remote/remoteGui.less';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'remote';
const dark = params.has('dark');
await (mode === 'web' ? import('../../web/src/styles.css') : import('../src/styles.css'));
setInterfaceLanguage('zh'); saveGlobalFontSize(params.has('large') ? 20 : 14);
(mode === 'web' ? setThemeMode : applyThemeMode)(dark ? 'dark' : 'light');
const fixture = createDirectoryFixture();
const controller = new ChatController(events => ({ request: fixture.request,
  start: () => { fixture.listen(events.event); events.mode('direct'); events.ready(); }, stop() {} }));
const device = { deviceId: 'directory-fixture', name: '测试电脑', online: true, platform: 'windows' };
getGuiController().patch({ grouping: directoryFixtureGrouping });
Object.assign(window, { directoryFixture: fixture, directoryController: controller });

function Harness() {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => { if (mode !== 'local') controller.start(); return () => controller.stop(); }, []);
  const algorithm = dark ? theme.darkAlgorithm : theme.defaultAlgorithm;
  return <ApplicationTypography><ConfigProvider theme={{ algorithm: mode === 'web' ? algorithm
    : [algorithm, theme.compactAlgorithm], token: { colorPrimary: '#28837f' } }}><App>
    <main className={mode === 'remote' ? `${styles.page} chat-page gui-remote-workspace` : mode === 'web' ? 'chat-page' : ''}
      style={{ height: '100dvh' }}>
      {mode === 'local' ? <CodexGuiPage active accountPicker={null} providers={[]} aggregateApis={[]}
        plugins={{ authenticated: false, onLogin() {}, notify() {}, t: uiText }} />
        : <ConnectedChat chat={{ controller, state, foreground: true }} device={device} devices={[device]}
          active scope={`directory-${mode}`} email="fixture@example.test" chooseDevice={() => {}}
          renderSidebar={mode === 'remote' ? actions => <RemoteGuiSidebar state={state} controller={controller}
            actions={actions} accountPicker={null} focusMode={{ focused: false, onToggleFocus() {} }} /> : undefined} />}
    </main>
  </App></ConfigProvider></ApplicationTypography>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
