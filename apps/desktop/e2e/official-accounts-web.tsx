import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { App } from 'antd';
import { AccountsPage } from '../../web/src/accounts/AccountsPage';
import { WebLocaleProvider } from '../../web/src/i18n/WebLocaleProvider';
import { store } from '../../web/src/store';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { initializeTheme } from '../../web/src/theme/preference';
import { setGuiLanguage } from '../../../shared/localization/uiText';
import { saveGlobalFontSize } from '../../../shared/appearance/fontSize';
import 'antd/dist/reset.css';
import 'antd-mobile/es/global';
import '../../web/src/styles.css';

initializeTheme(); setGuiLanguage('zh');
saveGlobalFontSize(Number(new URLSearchParams(location.search).get('font') || 14));
const session = { baseUrl: 'https://fixture.invalid', email: 'review@example.test', accessToken: 'mock', refreshToken: 'mock' };
store.dispatch({ type: 'data/refreshAll/fulfilled', payload: {
  accounts: [{ id: 'mock-codex', email: 'codex@example.test', plan: 'plus', usage: {}, active: true }],
  devices: [{ deviceId: 'mock-pc', name: 'Work PC', platform: 'Windows', online: true }],
} });
createRoot(document.getElementById('root')!).render(<Provider store={store}>
  <ApplicationTypography><WebLocaleProvider><App><AccountsPage session={session} /></App></WebLocaleProvider></ApplicationTypography>
</Provider>);
