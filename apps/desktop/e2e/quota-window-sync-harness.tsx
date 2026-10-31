import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { QuotaWindowSyncCard } from '../src/pages/settings/QuotaWindowSyncCard';
import { QuotaWindowSyncGuidance } from '../../web/src/settings/QuotaWindowSyncGuidance';
import { translate, type Language } from '../src/i18n';
import 'antd/dist/reset.css';
import '../src/styles.css';

const params = new URLSearchParams(location.search);
const language = (params.get('language') ?? 'zh') as Language;
if (params.get('mode') === 'cloud') {
  await import('../../web/src/styles.css');
  await import('../../web/src/settings/styles.css');
} else {
  await import('../src/pages/SettingsPage/index.module.less');
}

createRoot(document.getElementById('root')!).render(<ConfigProvider theme={{
  algorithm: theme.compactAlgorithm,
  token: { colorPrimary: '#35ada7', borderRadius: 6, fontFamily: '"DM Sans", "Microsoft YaHei UI", sans-serif' },
}}>
  <main className="settings-page" style={{ padding: 32, maxWidth: 1000, margin: '0 auto' }}>
    {params.get('mode') === 'cloud' ? <section className="settings-group"><QuotaWindowSyncGuidance /></section>
      : <QuotaWindowSyncCard t={(key, values) => translate(language, key, values)} />}
  </main>
</ConfigProvider>);
