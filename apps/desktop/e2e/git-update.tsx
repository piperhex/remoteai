import { createRoot } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { mockIPC } from '@tauri-apps/api/mocks';
import { createAsyncGitFixture } from '../../../shared/remote-chat/testing/gitFixture';
import { createGuiToolsClient } from '../../../shared/remote-chat/guiTools';
import { useRemoteGit } from '../../../shared/remote-chat/useRemoteGit';
import { GitToolbar } from '../../../shared/git/views/GitToolbar';
import { GitChanges } from '../../../shared/git/views/GitChanges';
import { useGitTheme } from '../../../shared/git/views/gitTheme';
import { displayError, setLanguage, useLanguage } from '../../../shared/localization/browserClient';
import { ApplicationTypography } from '../../../shared/appearance/ApplicationTypography';
import { saveGlobalFontSize } from '../../../shared/appearance/fontSize';
import type { GitActionRequest, GitChanges as Changes, GitResolution } from '../../../shared/remote-chat/gitTypes';
import '../../../shared/git/views/git.css';

const query = new URLSearchParams(location.search);
const mode = query.get('mode') ?? 'local';
const fixture = createAsyncGitFixture();
const original = await fixture.changes('/fixture');
let state: Changes = { ...original };
let request: GitActionRequest | undefined;
let release: (() => void) | undefined;
const backup = { id: 'test-update', stash: 'a'.repeat(40), native: false, phase: 'review' as const };
fixture.changes = async () => state;
fixture.action = async input => {
  request = input;
  await new Promise<void>(resolve => { release = resolve; });
  if (query.has('conflict') || query.has('collision')) {
    state = { ...state, updateBackup: backup, integration: { kind: 'stash', version: 'recovery-v1' },
      files: query.has('collision') ? state.files : [{ ...state.files[0], conflict: true, status: 'UU' }] };
    throw new Error('client.gitUpdate.restoreFailed');
  }
};
fixture.resolveConflict = async input => {
  state = { ...state, files: state.files.map(file => file.path === input.path
    ? { ...file, conflict: false, status: 'M ' } : file) };
};
fixture.continueIntegration = async () => { state = { ...state, updateBackup: null, integration: null }; };

async function nativeRequest(input: Record<string, unknown>) {
  const cwd = String(input.cwd);
  switch (input.operation) {
    case 'changes': return fixture.changes(cwd);
    case 'repository': return fixture.repository(cwd);
    case 'history': return fixture.history(cwd, 0);
    case 'settings': return fixture.settings();
    case 'action': return fixture.action(input as unknown as GitActionRequest);
    case 'conflict': return fixture.conflict(cwd, String(input.path));
    case 'resolveConflict': return fixture.resolveConflict(input as unknown as GitResolution);
    case 'continueIntegration': return fixture.continueIntegration(cwd, String(input.version));
    default: throw new Error(String(input.operation));
  }
}
mockIPC((command, args) => command === 'codex_gui_git_tool'
  ? nativeRequest(args!.request as Record<string, unknown>) : null);
const { localGitClient } = await import('../src/pages/codexGui/localGitClient');
const { guiToolRequest } = await import('../src/remoteChat/guiTools');
const remote = createGuiToolsClient(async <T,>(body: object) =>
  guiToolRequest(body as Record<string, unknown>) as Promise<T>).git;
saveGlobalFontSize(Number(query.get('font') ?? 14));

function Fixture() {
  useLanguage();
  const panel = useRemoteGit({ client: mode === 'local' ? localGitClient : remote,
    cwd: '/fixture', connected: true, active: true, refreshInterval: 1000 });
  const colors = useGitTheme();
  const { token } = theme.useToken();
  return <div className="chat-git" style={{ ...colors, height: '100vh', maxWidth: 560, margin: 'auto',
    fontSize: token.fontSize, fontFamily: token.fontFamily, lineHeight: token.lineHeight }}>
    <nav aria-label="Fixture controls"><button onClick={() => release?.()}>Finish request</button>
      <button onClick={() => setLanguage('en')}>English</button>
      <button onClick={() => setLanguage('ja')}>日本語</button></nav>
    <GitToolbar panel={panel} connected />
    {panel.notice && <p role="status" className="git-notice">{displayError(panel.notice)}</p>}
    {panel.error && <p role="alert" className="git-error">{displayError(panel.error)}</p>}
    <GitChanges panel={panel} connected />
    <span data-testid="strategy">{request?.strategy}</span>
  </div>;
}
const colorTheme = query.has('dark') ? theme.darkAlgorithm : theme.defaultAlgorithm;
createRoot(document.getElementById('root')!).render(<ConfigProvider theme={{
  algorithm: mode === 'web' ? colorTheme : [colorTheme, theme.compactAlgorithm],
  token: { motion: false },
}}><ApplicationTypography><Fixture /></ApplicationTypography></ConfigProvider>);
