import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import { ProxyAccountPicker } from '../src/pages/codexGui/ProxyAccountPicker';
import { useGuiComputers } from '../src/pages/codexGui/remote/useGuiComputers';
import { RemoteGuiWorkspaces } from '../src/pages/codexGui/remote/RemoteGuiWorkspaces';
import { DEMO_ACCOUNTS } from '../src/demo';
import styles from '../../../shared/conversation/styles.module.less';
import { GuiToolbox } from '../../../shared/conversation/GuiToolbox';
import { GuiHostPicker } from '../../../shared/conversation/GuiHostPicker';
import { ProjectPicker } from '../src/pages/codexGui/ProjectPicker';
import { DetailsWorkspace } from '../../../shared/conversation/DetailsWorkspace';
import { guiFontStyle, useGuiFontSize } from '../../../shared/conversation/guiAppearance';
import { createAsyncGitFixture } from '../../../shared/remote-chat/testing/gitFixture';
import { WindowControls } from '../src/components/WindowControls';
import { translate } from '../src/i18n';
import { useGuiLanguage } from '../../../shared/localization/useGuiLanguage';
import { DesktopUsageContext } from '../../../shared/chat/DesktopUsageContext';
import 'antd/dist/reset.css';

const localGit = createAsyncGitFixture();
const localUsage = { totalTokens: 0, estimatedCostUsd: 0,
  primaryRemainingPercent: DEMO_ACCOUNTS[0].usage.primary?.remainingPercent ?? null,
  primaryRemainingAggregated: false, providerEstimatedCost: null };

function Harness() {
  // The real desktop root rerenders when its language preference changes.
  useGuiLanguage();
  const fontSize = useGuiFontSize();
  const [localDraft, setLocalDraft] = useState('Local unsent draft');
  const [project, setProject] = useState('/local/workspace');
  const [focused, setFocused] = useState(false);
  const computers = useGuiComputers({ active: true, identity: { baseUrl: 'https://fixture.test', userId: 'owner' },
    login: () => {} });
  const device = computers.current;
  return <ConfigProvider><header hidden={focused} style={{ height: 48 }}>Codex GUI</header>
    <main style={{ ...guiFontStyle(fontSize), height: focused ? '100vh' : 'calc(100vh - 48px)' }}>
    <DesktopUsageContext.Provider value={{ usage: localUsage, visible: !device }}>
    <div hidden={Boolean(device)} style={{ height: '100%' }}>
      <DetailsWorkspace active={!device} selected={project}>
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
              cwd={project} />}
            hostPicker={<GuiHostPicker navigation={computers} active={!device} />} />
          <textarea aria-label="本机草稿" value={localDraft} onChange={event => setLocalDraft(event.target.value)} />
        </div>
      </div></div></DetailsWorkspace></div></DesktopUsageContext.Provider>
    {computers.identity && <RemoteGuiWorkspaces active identity={computers.identity}
      current={device} computers={computers} privacyMode={false}
      focusMode={{ focused, onToggleFocus: () => setFocused(value => !value) }}
      windowControls={<WindowControls t={(key, values) => translate('zh', key, values)}
        onError={error => { throw new Error(error); }} />} />}
  </main></ConfigProvider>;
}

const style = document.createElement('style');
style.textContent = `*{box-sizing:border-box}body{margin:0;min-width:0;font-family:Microsoft YaHei,sans-serif}
  :root{--ink:#233329;--panel:#fff;--bg:#f6f8f7;--line:#dfe6e1;--muted:#66796d;--green:#168348;
  --green-dark:#126a3b;--green-selection:#c6f4e8;--green-selection-hover:#e7f4ec}
  .local-workspace{display:flex;height:100%}.local-workspace aside{width:236px;flex-shrink:0}
  .local-workspace textarea{width:100%;min-height:120px;resize:none;padding:20px;border:1px solid var(--line);
    border-radius:18px;background:var(--panel);font:inherit}
  .gui-remote-workspace[hidden]{display:none}`;
document.head.append(style);
createRoot(document.getElementById('root')!).render(<Harness />);
