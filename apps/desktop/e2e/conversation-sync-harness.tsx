import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { ConversationSyncPanel } from '../../../shared/conversation/sync/ConversationSyncPanel';
import { ConversationSyncDialog } from '../../../shared/conversation/sync/ConversationSyncDialog';
import { conversationSyncFixture } from '../../../shared/testing/conversationSyncFixture';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { saveGlobalFontSize } from '../../../shared/appearance/fontSize';
import { setGuiLanguage } from '../../../shared/localization/uiText';
import 'antd/dist/reset.css';
import '../src/styles.css';

const parameters = new URLSearchParams(location.search);
const fixture = conversationSyncFixture(parameters);
Reflect.set(window, 'syncCalls', fixture.calls);
Reflect.set(window, 'releaseSyncTransfer', fixture.release);
setGuiLanguage(parameters.get('language') === 'en' ? 'en' : 'zh');
saveGlobalFontSize(Number(parameters.get('font')) || 14);
const dark = parameters.has('dark');
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
createRoot(document.getElementById('root')!).render(
  <ApplicationTypography><ConfigProvider theme={{ algorithm: [dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    theme.compactAlgorithm], token: { colorPrimary: '#28837f' } }}>
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {parameters.has('dialog')
        ? <ConversationSyncDialog><ConversationSyncPanel {...fixture} onSynced={() => {}} /></ConversationSyncDialog>
        : <ConversationSyncPanel {...fixture} onSynced={() => {}} />}
    </div>
  </ConfigProvider></ApplicationTypography>,
);
