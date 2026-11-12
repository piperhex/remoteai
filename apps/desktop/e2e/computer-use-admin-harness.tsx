import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import { ConfigProvider, theme } from 'antd';
import type { ComputerUseStatus } from '../src/api/computerUse';
import '../src/styles.css';
import guiStyles from '../src/pages/codexGui/GuiPluginsPage.module.less';

const query = new URLSearchParams(location.search);
const mode = query.get('state');
const status: ComputerUseStatus = { installed: true, enabled: true, supported: true,
  needsRepair: false, permissions: null, version: '0.37.0-remoteai.4',
  administrator: query.has('plain') ? null : { requested: mode === 'active' || mode === 'denied',
    active: mode === 'active', inherited: false, attempted: mode === 'active' || mode === 'denied' } };
document.body.dataset.authorizations = '0';
mockIPC(async (command, payload) => {
  if (command === 'computer_use_action') {
    const action = (payload as Record<string, unknown>).action;
    if (action === 'enableAdministrator') status.administrator!.requested = true;
    if (action === 'revokeAdministrator') Object.assign(status.administrator!, { requested: false, active: false });
    if (action === 'enableAdministrator' || action === 'grantAdministrator') {
      document.body.dataset.authorizations = String(Number(document.body.dataset.authorizations) + 1);
      status.administrator!.attempted = true;
      if (mode === 'denied' || query.has('deny')) {
        throw JSON.stringify({ code: 'client.computerUseAdmin.authorizationFailed' });
      }
      status.administrator!.active = true;
    }
  }
  return structuredClone(status);
});
const { ComputerUseCard } = await import('../src/pages/skillsMarket/ComputerUseCard');
const { ApplicationTypography } = await import('../../../shared/appearance/ApplicationTypography');
const { setGuiLanguage } = await import('../../../shared/localization/uiText');
const { saveGlobalFontSize } = await import('../../../shared/appearance/fontSize');
setGuiLanguage(query.get('language') === 'ru' ? 'ru' : query.get('language') === 'en' ? 'en' : 'zh');
saveGlobalFontSize(Number(query.get('font') || 14));
const dark = query.has('dark');
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
document.body.style.cssText = 'min-width:0;overflow:auto;padding:32px';
createRoot(document.getElementById('root')!).render(
  <ConfigProvider theme={{ algorithm: [dark ? theme.darkAlgorithm : theme.defaultAlgorithm, theme.compactAlgorithm] }}>
    <ApplicationTypography><main className={query.has('gui') ? guiStyles.content : undefined}
      style={{ width: '100%', maxWidth: 360 }}>
      <ComputerUseCard homeId="fixture" active onBusyChange={() => undefined} />
    </main></ApplicationTypography>
  </ConfigProvider>,
);
