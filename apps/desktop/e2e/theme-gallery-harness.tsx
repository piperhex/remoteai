import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider, theme } from 'antd';
import { DreamSkinPage } from '../src/pages/DreamSkinPage';
import { GuiAutoSwitchSettingsDialog } from '../src/pages/codexGui/GuiAutoSwitchSettingsDialog';
import { useLanguage } from '../src/hooks/useLanguage';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import 'antd/dist/reset.css';
import '../src/styles.css';

const params = new URLSearchParams(location.search);
const dark = params.has('dark');
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
function Harness() {
  const [open, setOpen] = useState(true);
  const { t } = useLanguage();
  Object.assign(window, { themeGalleryFixture: { show: setOpen } });
  return <ConfigProvider theme={{ algorithm: [dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    theme.compactAlgorithm] }}><ApplicationTypography><App>
    <div data-testid="gallery-scroll" style={{ height: '100vh', overflow: 'auto', padding: 20 }}>
      {open && (params.has('dialog')
        ? <GuiAutoSwitchSettingsDialog accounts={[]} providers={[]} privacyMode={false}
          onClose={() => setOpen(false)} />
        : <DreamSkinPage t={t} notify={() => {}} />)}
    </div>
  </App></ApplicationTypography></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
