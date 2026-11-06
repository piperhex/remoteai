import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatTokenSummary } from '../../web/src/chat/ChatTokenSummary';
import { demoTokenSummary } from './demo-token-summary';
import { officialUsageFixture } from './official-usage-fixture';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { ConfigProvider, theme } from 'antd';
import { setThemeMode } from '../../web/src/theme/preference';
import '../../web/src/styles.css';
import '../../../shared/remote-chat/views/chat.css';
import './token-native-observer';

let reads = 0;
Object.assign(window, { remoteReadCount: () => reads });
const read = async (weeks = 2) => {
  reads++;
  if ('__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('probe_shared_read');
  } else await fetch(`/token-remote-fixture?weeks=${weeks}`);
  return { ...demoTokenSummary({ weeks }), officialUsage: officialUsageFixture(), refreshSeconds: 1 };
};
function Harness() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open summary</button>
    {open && <ChatTokenSummary read={read} ready scope="token-lifecycle:account:computer"
      deviceName="Test computer" onClose={() => setOpen(false)} />}</>;
}
const dark = new URLSearchParams(location.search).has('dark');
setThemeMode(dark ? 'dark' : 'light');
createRoot(document.getElementById('root')!).render(<ApplicationTypography>
  <ConfigProvider theme={{ algorithm: dark ? [theme.darkAlgorithm, theme.compactAlgorithm] : theme.compactAlgorithm,
    token: { colorPrimary: '#30aaa5', fontFamily: '"DM Sans", "Microsoft YaHei UI", sans-serif' } }}>
    <Harness />
  </ConfigProvider>
</ApplicationTypography>);
