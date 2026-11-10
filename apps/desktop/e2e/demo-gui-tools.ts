import type { TerminalInfo } from '../src/pages/codexGui/terminal/api';
import { TerminalOutput } from '../src/remoteChat/terminalOutput';
import { terminalBelongsToProject } from '../../../shared/remote-chat/terminalProject';
import { demoGitTools } from './demo-git-tools';
import { demoTaskReview } from './demo-task-review';
import type { SshConnect } from '../../../shared/terminal/ssh';
import { demoGuiSettings } from './gui-settings-fixture';

let version = '0.155.0';
let completedAt = 0;
const terminals = new Map<string, { info: TerminalInfo; output: TerminalOutput }>();

export function demoGuiTools(input: Record<string, unknown>) {
  const settings = demoGuiSettings(input);
  if (settings) return settings.value;
  if (String(input.operation).startsWith('guiTask')) return demoTaskReview(input);
  if (String(input.operation).startsWith('guiGit')) return demoGitTools(input);
  if (input.operation === 'guiCliRelease') return { version: '0.156.0', size: 50_000_000 };
  if (input.operation === 'guiCliInstall') completedAt = Date.now() + 1800;
  if (input.operation === 'guiCliStatus' || input.operation === 'guiCliInstall') {
    const installing = Date.now() < completedAt;
    if (completedAt && !installing) version = '0.156.0';
    return { version, installing, error: '',
      progress: installing ? { downloaded: 25_000_000, total: 50_000_000, phase: 'downloading' } : null };
  }
  if (input.operation === 'guiReconnect') return {};
  if (input.operation === 'guiTerminalList') return [...terminals.values()].map(session => session.info)
    .filter(info => typeof input.cwd !== 'string' || terminalBelongsToProject(info, input.cwd));
  if (input.operation === 'guiTerminalSshProbe') return 'SHA256:fixture';
  if (input.operation === 'guiTerminalSshOpen') {
    const request = input.request as SshConnect;
    const info = { id: crypto.randomUUID(), cwd: '', projectCwd: String(input.cwd ?? ''), shell: 'SSH',
      ssh: { ...request.endpoint, username: request.username } };
    const output = new TerminalOutput();
    output.push({ type: 'output', data: [...new TextEncoder().encode('SSH ready\r\n$ ')] });
    terminals.set(info.id, { info, output });
    return info;
  }
  if (input.operation === 'guiTerminalOpen') {
    const id = crypto.randomUUID();
    const info = { id, cwd: String(input.cwd || '/remote'), projectCwd: String(input.cwd ?? ''), shell: 'Remote bash' };
    const output = new TerminalOutput();
    output.push({ type: 'output', data: [...new TextEncoder().encode('Remote shell ready\r\n$ ')] });
    terminals.set(id, { info, output });
    return info;
  }
  const id = String(input.id);
  if (input.operation === 'guiTerminalRead') {
    return terminals.get(id)?.output.read(Number(input.cursor ?? 0))
      ?? { found: false, cursor: 0, truncated: false, events: [] };
  }
  if (input.operation === 'guiTerminalWrite') {
    terminals.get(id)?.output.push({ type: 'output', data: [...new TextEncoder().encode(String(input.data))] });
  }
  if (input.operation === 'guiTerminalClose') terminals.delete(id);
  return {};
}
