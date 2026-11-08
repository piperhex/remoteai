import { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, Input, theme } from 'antd';
import { ProjectPicker } from '../src/pages/codexGui/ProjectPicker';
import { RemoteProjectPicker } from '../../../shared/conversation/remote/RemoteProjectPicker';
import { ChatController } from '../../../shared/remote-chat/client/controller';
import { guiApi } from '../../../shared/conversation/api';
import { saveProject } from '../../../shared/conversation/projectCatalog';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { ProjectBar } from '../../../shared/conversation/ProjectBar';
import styles from '../../../shared/conversation/styles.module.less';
import { saveGlobalFontSize } from '../../../shared/appearance/fontSize';
import { useGuiLanguage } from '../../../shared/localization/useGuiLanguage';
import { setLanguage } from '../../../shared/localization/browserClient';
import { applyThemeMode } from '../src/utils/themeMode';
import { setThemeMode } from '../../web/src/theme/preference';
import { explorerRoot, explorerCalls, explorerRequest } from './project-explorer-fixture';
import 'antd/dist/reset.css';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'local';
const dark = params.has('dark');
const disabled = params.has('disabled');
const projects = [{ cwd: explorerRoot, label: 'codex-switch' },
  { cwd: `${explorerRoot}/docs`, label: 'mailBot' }, { cwd: `${explorerRoot}/scripts`, label: '新版视频' }];
if (mode === 'web') {
  await import('../../web/src/styles.css');
  setThemeMode(dark ? 'dark' : 'light');
} else {
  await import('../src/styles.css');
  applyThemeMode(dark ? 'dark' : 'light');
}
setLanguage('zh');
saveGlobalFontSize(Number(params.get('font') ?? 14));
for (const project of projects) saveProject({ path: project.cwd, name: project.label });
guiApi.request = explorerRequest;
const controller = new ChatController(() => ({ start() {}, stop() {},
  request: <T,>(_method: string, body: object) => 'operation' in body && body.operation === 'guiProjects'
    ? Promise.resolve(projects as T) : explorerRequest<T>(body),
}));
Object.assign(controller.snapshot(), { ready: !disabled, draftProject: projects[0] });
Object.assign(window, { explorerCalls, setExplorerLanguage: setLanguage });

function Harness() {
  useGuiLanguage();
  const [path, setPath] = useState(explorerRoot);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const algorithm = dark ? theme.darkAlgorithm : theme.defaultAlgorithm;
  return <ApplicationTypography><ConfigProvider theme={{
    algorithm: mode === 'web' ? algorithm : [algorithm, theme.compactAlgorithm], token: { motion: false },
  }}><main className={styles.page} style={{ padding: 40, height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'end',
    gap: 12, background: 'var(--bg)', color: 'var(--ink)' }}>
    {mode === 'local' ? <ProjectPicker value={path} projects={projects.map(project => project.cwd)} disabled={disabled}
      onChange={setPath} onError={error => { throw error; }} />
      : <ProjectBar active scope={state.draftProject?.cwd ?? ''}>
        <RemoteProjectPicker state={state} controller={controller} active /></ProjectBar>}
    <Input.TextArea aria-label="消息草稿" rows={3} />
    <output data-testid="selected-project" hidden>{mode === 'local' ? path : state.draftProject?.cwd}</output>
  </main></ConfigProvider></ApplicationTypography>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
