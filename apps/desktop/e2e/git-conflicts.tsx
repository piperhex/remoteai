import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { ConfigProvider, theme } from 'antd';
import { mockIPC } from '@tauri-apps/api/mocks';
import { createAsyncGitFixture } from '../../../shared/remote-chat/testing/gitFixture';
import { createGuiToolsClient } from '../../../shared/remote-chat/guiTools';
import { useRemoteGit } from '../../../shared/remote-chat/useRemoteGit';
import { GitChanges } from '../../../shared/git/views/GitChanges';
import { useGitTheme } from '../../../shared/git/views/gitTheme';
import { displayError, setLanguage, useLanguage } from '../../../shared/localization/browserClient';
import type { GitConflict, GitResolution } from '../../../shared/remote-chat/gitTypes';
import '../../../shared/git/views/git.css';

const query = new URLSearchParams(location.search);
const mode = query.get('mode') ?? 'local';
const fixture = createAsyncGitFixture();
let resolved = false; let completed = false;
let saved: string | null = '';
const snapshot: GitConflict = { path: 'src/greeting.ts', version: 'snapshot-v1',
  base: 'export const greeting = "Hello";\nexport const color = "gray";\n',
  ours: 'export const greeting = "Welcome";\nexport const color = "blue";\n',
  theirs: 'export const greeting = "你好";\nexport const color = "green";\n',
  result: '// Keep the shared header\n<<<<<<< HEAD\nexport const greeting = "Welcome";\n'
    + '||||||| base\nexport const greeting = "Hello";\n=======\nexport const greeting = "你好";\n'
    + '>>>>>>> incoming\n\n// Theme configuration\n<<<<<<< HEAD\nexport const color = "blue";\n'
    + '=======\nexport const color = "green";\n>>>>>>> incoming\n// Keep the shared footer\n', markerSize: 7 };
if (query.has('delete')) { snapshot.theirs = null; snapshot.result = snapshot.ours; }
const changes = fixture.changes;
fixture.changes = async cwd => ({ ...await changes(cwd), files: [{ path: snapshot.path, originalPath: null,
  status: resolved ? 'M ' : 'UU', conflict: !resolved, version: resolved ? 'resolved-v1' : 'conflict-v1' }],
  integration: completed ? null : { kind: query.has('rebase') ? 'rebase' : 'merge', version: 'merge-v1' } });
fixture.conflict = async () => {
  if (query.has('unsupported')) throw 'client.gitConflict.unsupported';
  return snapshot;
};
fixture.resolveConflict = async (input: GitResolution) => {
  if (query.has('stale')) throw 'client.gitConflict.changed';
  if (input.version !== snapshot.version) throw 'client.gitConflict.changed';
  saved = input.content; resolved = true;
};
fixture.continueIntegration = async () => { completed = true; };

async function nativeRequest(input: Record<string, unknown>) {
  const cwd = String(input.cwd);
  switch (input.operation) {
    case 'changes': return fixture.changes(cwd);
    case 'repository': return fixture.repository(cwd);
    case 'history': return fixture.history(cwd, 0);
    case 'settings': return fixture.settings();
    case 'conflict': return fixture.conflict(cwd, String(input.path));
    case 'resolveConflict': return fixture.resolveConflict(input as unknown as GitResolution);
    case 'continueIntegration': return fixture.continueIntegration(cwd, String(input.version));
    default: throw new Error(String(input.operation));
  }
}
mockIPC((command, args) => {
  if (command === 'codex_gui_git_tool') return nativeRequest(args!.request as Record<string, unknown>);
  return null;
});
const local = (await import('../src/pages/codexGui/localGitClient')).localGitClient;
const { guiToolRequest } = await import('../src/remoteChat/guiTools');
const remote = createGuiToolsClient(async <T,>(body: object) =>
  guiToolRequest(body as Record<string, unknown>) as Promise<T>).git;
const client = mode === 'local' ? local : remote;

function Fixture() {
  useLanguage();
  const [connected, setConnected] = useState(true);
  const panel = useRemoteGit({ client, cwd: '/fixture', connected, active: true, refreshInterval: 1000 });
  const colors = useGitTheme();
  return <div className={`chat-git ${mode === 'remote' ? 'gui-remote-workspace' : ''}`}
    style={{ ...colors, height: '100vh' }}>
    <nav><button onClick={() => setConnected(!connected)}>Connection</button>
      <button onClick={() => setLanguage('en')}>English</button><button onClick={() => setLanguage('ja')}>日本語</button></nav>
    <GitChanges panel={panel} connected={connected} />
    {panel.notice && <p role="status">{displayError(panel.notice)}</p>}
    <output data-testid="saved-content">{saved === null ? '(deleted)' : saved}</output>
    <output data-testid="completed">{String(completed)}</output>
  </div>;
}
createRoot(document.getElementById('root')!).render(<ConfigProvider theme={{
  algorithm: query.has('dark') ? theme.darkAlgorithm : theme.defaultAlgorithm,
}}><Fixture /></ConfigProvider>);
