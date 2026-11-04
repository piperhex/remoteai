import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { ConfigProvider } from 'antd';
import TerminalPanel from '../../../../shared/terminal/views/TerminalPanel';
import { terminalApi } from '../../src/pages/codexGui/terminal/api';
import { useTerminalPanel } from '../../../../shared/terminal/views/useTerminalPanel';
import { DetailsWorkspace } from '../../../../shared/conversation/DetailsWorkspace';
import { RemoteTerminals } from '../../src/remoteChat/terminals';
import { createGuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { remoteTerminalApi } from '../../../../shared/remote-chat/terminalApi';
import { useRemoteTerminalPanel } from '../../../../shared/remote-chat/useRemoteTerminalPanel';
import { setInterfaceLanguage } from '../../../../shared/localization/interfaceLanguage';
import { memoryProfiles, type FixtureConfig } from './fixture';
import '../../src/styles.css';
import 'antd/dist/reset.css';

function App({ config }: { config: FixtureConfig }) {
  const [mode, setMode] = useState<'local' | 'remote'>('local');
  const local = useTerminalPanel(config.projectCwd);
  const [apis] = useState(() => {
    const profiles = memoryProfiles(config);
    terminalApi.ssh.profiles = profiles;
    const host = new RemoteTerminals();
    const client = createGuiToolsClient(<T,>(body: object) =>
      host.request(body as Record<string, unknown>, 'fixture') as Promise<T>);
    client.terminal.ssh.profiles = profiles;
    return { local: terminalApi, remote: remoteTerminalApi(client.terminal), remoteClient: client.terminal };
  });
  const remote = useRemoteTerminalPanel({ client: apis.remoteClient, cwd: config.projectCwd, connected: true });
  const panel = mode === 'local' ? local : remote;
  const api = apis[mode];
  return <ConfigProvider><DetailsWorkspace selected={mode} active enabled={false}>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <strong>Native SSH integration</strong>
        {(['local', 'remote'] as const).map(value => <button key={value} disabled={value === mode}
          onClick={() => setMode(value)}>{value}</button>)}
        <span>{config.name} · {config.host}:{config.port}</span>
      </header>
      <div style={{ flex: 1, padding: 16 }}>Open the terminal connection menu and choose the WSL fixture.</div>
      <TerminalPanel panel={{ ...panel, open: true }} api={api} active />
    </div>
  </DetailsWorkspace></ConfigProvider>;
}

setInterfaceLanguage('zh');
void invoke<FixtureConfig>('fixture_config').then(config => {
  createRoot(document.getElementById('root')!).render(<App config={config} />);
}).catch(() => { document.getElementById('root')!.textContent = 'Fixture config could not be loaded.'; });
