import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import { ProxyAccountPicker } from '../src/pages/codexGui/ProxyAccountPicker';
import { useGuiComputers } from '../src/pages/codexGui/remote/useGuiComputers';
import { RemoteGuiWorkspaces } from '../src/pages/codexGui/remote/RemoteGuiWorkspaces';
import { DEMO_ACCOUNTS } from '../src/demo';
import styles from '../src/pages/codexGui/styles.module.less';
import { GuiToolbox } from '../src/pages/codexGui/GuiToolbox';
import { GuiHostPicker } from '../src/pages/codexGui/GuiHostPicker';
import { ProjectPicker } from '../src/pages/codexGui/ProjectPicker';
import { createAsyncGitFixture } from '../../../shared/remote-chat/testing/gitFixture';
import 'antd/dist/reset.css';

const localGit = createAsyncGitFixture();

function Harness() {
  const [localDraft, setLocalDraft] = useState('Local unsent draft');
  const [project, setProject] = useState('/local/workspace');
  const computers = useGuiComputers({ active: true, identity: { baseUrl: 'https://fixture.test', userId: 'owner' },
    login: () => {} });
  const device = computers.current;
  return <ConfigProvider><main style={{ height: '100vh' }}>
    <div hidden={Boolean(device)} style={{ height: '100%' }}>
      <div className={`${styles.page} local-workspace`}><aside className={styles.sidebar}>
        <h3>本机会话</h3><div style={{ flex: 1 }} />
        <ProxyAccountPicker active={!device} privacyMode={false} computers={computers}
          accounts={[{ ...DEMO_ACCOUNTS[0], active: true }]} providers={[]} aggregateApis={[]} proxyRunning
          busy={false} loading={false} onSwitchAccount={async () => true} onSwitchProvider={async () => true} />
      </aside><div className={styles.workspace} style={{ flex: 1 }}>
        <div className={styles.composerWrap} style={{ marginTop: 'auto' }}>
          <ProjectPicker value={project} projects={['/local/workspace']} disabled={false}
            onChange={setProject} onError={error => { throw error; }}
            actions={<GuiToolbox trigger="git" active={!device} connected git={localGit}
              cwd={project} deviceName="本机" />}
            hostPicker={<GuiHostPicker navigation={computers} active={!device} />} />
          <textarea aria-label="本机草稿" value={localDraft} onChange={event => setLocalDraft(event.target.value)} />
        </div>
      </div></div></div>
    {computers.identity && <RemoteGuiWorkspaces active identity={computers.identity}
      current={device} computers={computers} privacyMode={false} focusMode={{ focused: false, onToggleFocus() {} }} />}
  </main></ConfigProvider>;
}

const style = document.createElement('style');
style.textContent = `*{box-sizing:border-box}body{margin:0;font-family:Microsoft YaHei,sans-serif}
  :root{--ink:#233329;--panel:#fff;--bg:#f6f8f7;--line:#dfe6e1;--muted:#66796d;--green:#168348;
  --green-dark:#126a3b;--green-selection:#c6f4e8;--green-selection-hover:#e7f4ec}
  .local-workspace{display:flex;height:100%}.local-workspace aside{width:236px;flex-shrink:0}
  .local-workspace textarea{width:100%;min-height:120px;resize:none;padding:20px;border:1px solid var(--line);
    border-radius:18px;background:var(--panel);font:inherit}
  .gui-remote-workspace[hidden]{display:none}`;
document.head.append(style);
createRoot(document.getElementById('root')!).render(<Harness />);
