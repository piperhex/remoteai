import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import { ProjectPicker } from '../src/pages/codexGui/ProjectPicker';
import { GuiHostPicker } from '../../../shared/conversation/GuiHostPicker';
import { GuiToolbox } from '../../../shared/conversation/GuiToolbox';
import { LocalProjectBrowser } from '../src/pages/codexGui/LocalProjectBrowser';
import { localGitClient } from '../src/pages/codexGui/localGitClient';
import { RemoteGuiProject } from '../../../shared/conversation/remote/RemoteGuiProject';
import { ChatController } from '../../../shared/remote-chat/client/controller';
import { initialChatState } from '../../../shared/remote-chat/client/types';
import { gitApi, type GitStatus, type GitRequest } from '../../../shared/conversation/gitApi';
import type { GuiComputerNavigation } from '../../../shared/conversation/remote/types';
import { setGuiLanguage } from '../../../shared/localization/uiText';
import { useGuiLanguage } from '../../../shared/localization/useGuiLanguage';
import styles from '../../../shared/conversation/styles.module.less';
import 'antd/dist/reset.css';
import '../src/styles.css';
import '../../web/src/chat/desktopTools.css';
import '../src/pages/codexGui/remote/remoteGui.less';

const mode = new URLSearchParams(location.search).get('mode') ?? 'local';
const draft = new URLSearchParams(location.search).has('draft');
let branch: string | null = 'feature/conversation-context';
let unavailable = false;
const initialCwd = 'F:/projects/codex-switch';
const linkedCwd = 'F:/projects/worktrees/parallel-worktree-with-a-long-name';
const read = async (cwd: string): Promise<GitStatus> => {
  if (unavailable) throw new Error('Not a repository');
  return { cwd, branch, branches: [{ name: 'main', occupied: false }],
    changedFiles: 0, isWorktree: cwd === linkedCwd };
};
const workspace = (request: GitRequest) => {
  if (request.operation === 'switch') branch = request.branch;
  return read(request.cwd);
};
gitApi.request = workspace;
const controller = new ChatController(() => ({ start() {}, stop() {}, request: async () => {
  throw new Error('Unexpected fixture request');
} }));
controller.guiTools.workspace = workspace;
controller.guiTools.projects.list = async () => [{ cwd: initialCwd, label: 'codex-switch' }];
const device = { deviceId: 'remote', name: 'Office PC', platform: 'windows', online: true };
const computers: GuiComputerNavigation = { current: device, devices: [device], authenticated: true,
  allowLocal: mode !== 'web', loading: false, error: '', refresh() {}, choose() {}, login() {} };
setGuiLanguage('zh');

function Harness() {
  useGuiLanguage();
  const [running, setRunning] = useState(!draft);
  const [narrow, setNarrow] = useState(false);
  const [cwd, setCwd] = useState(initialCwd);
  const state = { ...initialChatState(), ready: true, draftProject: { cwd, label: 'codex-switch' },
    selected: draft ? null : { id: 'current', cwd,
      turns: [{ id: 'turn', status: running ? 'inProgress' : 'completed', items: [] }] } };
  return <ConfigProvider><div className={`${styles.page} chat-page ${mode === 'remote' ? 'gui-remote-workspace' : ''}`}
    style={{ display: 'block', minHeight: '100vh', padding: 24 }}>
    <nav style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <button onClick={() => setRunning(value => !value)}>{running ? 'Finish turn' : 'Start turn'}</button>
      <button onClick={() => setCwd(value => value === initialCwd ? linkedCwd : initialCwd)}>Switch conversation</button>
      <button onClick={() => { branch = 'feature/updated'; window.dispatchEvent(new Event('focus')); }}>Change branch</button>
      <button onClick={() => { unavailable = true; window.dispatchEvent(new Event('focus')); }}>Git unavailable</button>
      <button onClick={() => setGuiLanguage('en')}>English</button>
      <button onClick={() => setNarrow(value => !value)}>{narrow ? 'Widen chat' : 'Narrow chat'}</button>
    </nav>
    <div style={{ display: 'flex', flexDirection: 'column', width: `min(100%, ${narrow ? 450 : 920}px)`,
      margin: '180px auto 0' }}>
      <p style={{ margin: 28 }}>正在检查项目文件…</p>
      {mode === 'local' ? <div className={styles.composerWrap}>
        <ProjectPicker value={cwd} projects={[cwd]} disabled={running} running={running} gitEnabled={draft}
          active onBusyChange={() => {}} onChange={setCwd} onError={error => { throw error; }}
          hostPicker={<GuiHostPicker navigation={{ ...computers, current: null }} active />}
          actions={<><GuiToolbox trigger="git" active connected cwd={cwd} git={localGitClient} />
            <LocalProjectBrowser cwd={cwd} active connected /></>} />
      </div> : <RemoteGuiProject state={state} controller={controller} computers={computers} active />}
      <div className={styles.composerWrap}><div className={styles.composer}>
        <textarea aria-label="Draft" placeholder="描述任务…" style={{ width: '100%', minHeight: 100,
          padding: 12, border: 0, resize: 'vertical', background: 'transparent', color: 'inherit' }} />
      </div></div>
    </div>
  </div></ConfigProvider>;
}

document.body.style.minWidth = '0';
createRoot(document.getElementById('root')!).render(<Harness />);
