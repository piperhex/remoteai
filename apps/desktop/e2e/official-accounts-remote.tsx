import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { ClaudeAccountsPanel } from '../../../shared/accounts/ClaudeAccountsPanel';
import { claudeFixture } from './official-accounts-fixture';
import { saveGlobalFontSize } from '../../../shared/appearance/fontSize';
import { setGuiLanguage } from '../../../shared/localization/uiText';
import 'antd/dist/reset.css';
import '../src/styles.css';

setGuiLanguage('zh');
const params = new URLSearchParams(location.search);
saveGlobalFontSize(Number(params.get('font') || 14));
const dark = params.has('dark');
createRoot(document.getElementById('root')!).render(<ApplicationTypography>
  <ConfigProvider theme={{ algorithm: [dark ? theme.darkAlgorithm : theme.defaultAlgorithm, theme.compactAlgorithm] }}>
    <main style={{ minHeight: '100vh', padding: 24, background: dark ? '#141414' : '#f5f5f5' }}>
      <div style={{ maxWidth: 840, margin: '0 auto' }}>
        <ClaudeAccountsPanel ready privacyMode={false} transport={claudeFixture} />
      </div>
    </main>
  </ConfigProvider>
</ApplicationTypography>);
