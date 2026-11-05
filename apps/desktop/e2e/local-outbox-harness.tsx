import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { ConnectedChat } from '../../../shared/remote-chat/views/ConnectedChat';
import { createLocalOutboxFixture } from '../../../shared/remote-chat/testing/localOutboxFixture';
import { setInterfaceLanguage } from '../../../shared/localization/interfaceLanguage';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import '../../web/src/styles.css';
import '../src/pages/codexGui/remote/remoteGui.less';

setInterfaceLanguage('zh');
const fixture = createLocalOutboxFixture();
const desktop = new URLSearchParams(location.search).has('desktop');
const device = { deviceId: 'pc', name: '测试电脑', platform: 'Windows', online: true };
function Harness() {
  const state = useSyncExternalStore(fixture.controller.subscribe, fixture.controller.snapshot);
  return <ConfigProvider theme={{ algorithm: desktop ? theme.compactAlgorithm : theme.defaultAlgorithm }}>
    <ApplicationTypography><main className={desktop ? 'gui-remote-workspace' : ''} style={{ height: '100dvh' }}>
      <ConnectedChat chat={{ state, controller: fixture.controller, foreground: true }} device={device}
        devices={[device]} active scope="outbox-test" email="test@example.test" chooseDevice={() => {}} />
    </main></ApplicationTypography>
  </ConfigProvider>;
}
Object.assign(window, { outboxFixture: fixture });
void fixture.start();
createRoot(document.getElementById('root')!).render(<Harness />);
