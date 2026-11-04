import { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { ProjectPicker } from '../src/pages/codexGui/ProjectPicker';
import { RemoteProjectPicker } from '../../../shared/conversation/remote/RemoteProjectPicker';
import { ChatProjectSwitch } from '../../../shared/remote-chat/views/ChatProjectSwitch';
import { ChatController } from '../../../shared/remote-chat/client/controller';
import { guiApi } from '../../../shared/conversation/api';
import { useGuiLanguage } from '../../../shared/localization/useGuiLanguage';
import { setLanguage } from '../../../shared/localization/browserClient';
import { applyThemeMode } from '../src/utils/themeMode';
import { setThemeMode } from '../../web/src/theme/preference';
import { explorerRoot, explorerCalls, explorerRequest, explorerBlockedPaths } from './project-explorer-fixture';
import 'antd/dist/reset.css';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'local';
const dark = params.has('dark');
const initialPath = params.has('computer') ? '' : explorerRoot;
if (params.has('stalled')) explorerBlockedPaths.add(initialPath);
if (mode === 'web') {
  await import('../../web/src/styles.css');
  await import('../../../shared/remote-chat/views/chat.css');
  setThemeMode(dark ? 'dark' : 'light');
} else {
  await import('../src/styles.css');
  applyThemeMode(dark ? 'dark' : 'light');
}
setLanguage('zh');
document.body.style.minWidth = '0';
guiApi.request = explorerRequest;
const controller = new ChatController(() => ({ start() {}, stop() {},
  request: <T,>(_method: string, body: object) => explorerRequest<T>(body),
}));
Object.assign(controller.snapshot(), { ready: true,
  draftProject: initialPath ? { cwd: initialPath, label: 'zczd-wms-b' } : null });
Object.assign(window, { explorerCalls, explorerBlockedPaths, setExplorerLanguage: setLanguage });

function Harness() {
  useGuiLanguage();
  const [path, setPath] = useState(initialPath);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  return <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: { motion: false, colorPrimary: '#1677d2' } }}>
    <main style={{ padding: 40, height: '100vh', background: 'var(--bg)' }}>
      <h2>Codex GUI</h2>
      {mode === 'local' && <ProjectPicker value={path} projects={[explorerRoot]} disabled={false}
        onChange={setPath} onError={error => { throw error; }} />}
      {mode === 'remote' && <RemoteProjectPicker state={state} controller={controller} active />}
      {mode === 'web' && <ChatProjectSwitch state={state} controller={controller} active />}
      <output data-testid="selected-project">{mode === 'local' ? path : state.draftProject?.cwd}</output>
    </main>
  </ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
