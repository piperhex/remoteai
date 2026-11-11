import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { RemoteAccountPicker } from '../../../shared/conversation/remote/RemoteAccountPicker';
import { claudeFixture } from './official-accounts-fixture';
import { saveGlobalFontSize } from '../../../shared/appearance/fontSize';
import { setGuiLanguage } from '../../../shared/localization/uiText';
import 'antd/dist/reset.css';
import '../src/styles.css';

setGuiLanguage('zh');
const params = new URLSearchParams(location.search);
saveGlobalFontSize(Number(params.get('font') || 14));
const dark = params.has('dark');
const noop = () => {};
createRoot(document.getElementById('root')!).render(<ApplicationTypography>
  <ConfigProvider theme={{ algorithm: [dark ? theme.darkAlgorithm : theme.defaultAlgorithm, theme.compactAlgorithm] }}>
    <main style={{ minHeight: '100vh', padding: 24, background: dark ? '#141414' : '#f5f5f5' }}>
      <RemoteAccountPicker active ready privacyMode={false} claudeAccounts={claudeFixture}
        client={{ read: async () => ({ running: true, selection: { kind: 'none' }, choices: [] }),
          select: async value => value, subscribe: () => noop }}
        computers={{ current: { deviceId: 'mock-pc', name: 'Work PC', platform: 'windows', online: true },
          devices: [], authenticated: true, loading: false, error: '', refresh: noop, choose: noop, login: noop }} />
    </main>
  </ConfigProvider>
</ApplicationTypography>);
