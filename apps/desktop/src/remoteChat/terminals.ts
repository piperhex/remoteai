import { terminalApi, type TerminalInfo, type TerminalSize } from '../pages/codexGui/terminal/api';
import { TerminalOutput } from './terminalOutput';
import { TerminalFlow } from './terminalFlow';
import { terminalBelongsToProject } from '../../../../shared/remote-chat/terminalProject';
import { invoke } from '../api/backend';
import { ensureSshX11, monitorSsh, openNativeSsh, probeSsh, sshFiles } from '../pages/codexGui/terminal/sshApi';
import type { SshConnect, SshEndpoint, SshFileAction, SshX11 } from '../../../../shared/terminal/ssh';

const MAX_TERMINALS = 8;
interface Session {
  info?: TerminalInfo; output: TerminalOutput; flow?: TerminalFlow; exited: boolean; legacyCursor: number;
}

/** PC-owned shells survive transport sessions. The native transport supplies the authenticated owner. */
export class RemoteTerminals {
  private readonly owners = new Map<string, Set<Session>>();

  async request(body: Record<string, unknown>, owner: string) {
    // Older clients must upgrade instead of writing an isolated PC copy after cloud migration.
    if (['guiTerminalSshProfiles', 'guiTerminalSshProfileSave', 'guiTerminalSshProfileRemove'].includes(
      String(body.operation))) throw new Error('client.ssh.updateRequired');
    if (body.operation === 'guiTerminalSshProbe') return probeSsh(body.endpoint as SshEndpoint);
    if (body.operation === 'guiTerminalSshEnsureX11') return ensureSshX11(body.options as SshX11);
    if (body.operation === 'guiTerminalList') {
      const cwd = body.cwd;
      if (cwd !== undefined && typeof cwd !== 'string') throw new Error('请选择有效的项目目录。');
      const sessions = [...(this.owners.get(owner) ?? [])].flatMap(session => session.info
        ? [{ ...session.info, ...(session.exited ? { exited: true } : {}) }] : []);
      // Older clients may still request all shells; current clients always send their project directory.
      return typeof cwd === 'string' ? sessions.filter(info => terminalBelongsToProject(info, cwd)) : sessions;
    }
    if (body.operation === 'guiTerminalOpen' || body.operation === 'guiTerminalSshOpen') return this.open(body, owner);
    const session = [...(this.owners.get(owner) ?? [])].find(entry => entry.info?.id === body.id);
    if (body.operation === 'guiTerminalRead') return readOutput(session, body.cursor, body.token);
    if (!session?.info) {
      if (body.operation === 'guiTerminalClose') return;
      throw new Error('终端已关闭，请新建终端。');
    }
    switch (body.operation) {
      case 'guiTerminalBinaryMode':
        if (!session.info.ssh || session.exited) throw new Error('client.ssh.closed');
        session.flow ??= new TerminalFlow(session.info.id, session.output);
        return session.flow.mode(body.token, body.enabled);
      case 'guiTerminalSshMonitor':
        if (!session.info.ssh || session.exited) throw new Error('client.ssh.closed');
        return monitorSsh(session.info.id);
      case 'guiTerminalSshFiles':
        if (!session.info.ssh || session.exited) throw new Error('client.ssh.closed');
        return sshFiles(session.info.id, body.request as SshFileAction);
      case 'guiTerminalLink': {
        const request = body.request;
        if (!request || typeof request !== 'object' || Array.isArray(request)
          || !('type' in request) || !['connect', 'read', 'write', 'close'].includes(String(request.type))) {
          throw new Error('链接无效，请检查后重试。');
        }
        return invoke('codex_gui_terminal_link', { request: { ...request, scope: session.info.id } });
      }
      case 'guiTerminalWrite':
        if (session.exited || typeof body.data !== 'string') throw new Error('终端已结束，请新建终端。');
        return terminalApi.write(session.info.id, body.data);
      case 'guiTerminalWriteBinary':
        if (!session.info.ssh || session.exited) throw new Error('client.ssh.closed');
        if (!Array.isArray(body.data) || body.data.length > 64 * 1024
          || !body.data.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
          throw new Error('client.ssh.invalid');
        }
        return terminalApi.writeBinary(session.info.id, body.data);
      case 'guiTerminalResize':
        if (!session.exited) return terminalApi.resize(session.info.id, body.size as TerminalSize);
        return;
      case 'guiTerminalClose':
        await terminalApi.close(session.info.id);
        this.owners.get(owner)?.delete(session);
        if (!this.owners.get(owner)?.size) this.owners.delete(owner);
        return;
      default: throw new Error('当前版本暂不支持此终端操作。');
    }
  }

  private async open(body: Record<string, unknown>, owner: string) {
    if (body.npmScript !== undefined && typeof body.npmScript !== 'string') {
      throw new Error('client.npmScripts.invalid');
    }
    if (typeof body.cwd !== 'string' || (body.projectCwd !== undefined && typeof body.projectCwd !== 'string')) {
      throw new Error('请选择有效的项目目录。');
    }
    const sessions = this.owners.get(owner) ?? new Set<Session>();
    if (sessions.size >= MAX_TERMINALS) throw new Error('终端较多，请先关闭一个再试。');
    this.owners.set(owner, sessions);
    const session: Session = { output: new TerminalOutput(), exited: false, legacyCursor: 0 };
    sessions.add(session);
    try {
      // The typed Rust command validates the directory, size and input limits off the UI thread.
      const onEvent = (event: import('../../../../shared/terminal/types').TerminalEvent) => {
        session.output.push(event);
        if (event.type === 'exit') session.exited = true;
      };
      const info = await (body.operation === 'guiTerminalSshOpen'
        ? openNativeSsh(body.request as SshConnect, onEvent)
        : terminalApi.open(body.cwd, body.size as TerminalSize, onEvent,
          body.npmScript === undefined ? undefined : { npmScript: body.npmScript as string }));
      // Rust resolves symlinks and the default home directory; retain the original project association separately.
      session.info = { ...info, projectCwd: body.projectCwd ?? body.cwd,
        ...(info.npmScript ? { npmScriptCwd: body.cwd } : {}) };
      return session.info;
    } catch (error) { sessions.delete(session); throw error; }
  }
}

async function readOutput(session: Session | undefined, requestedCursor: unknown, token: unknown) {
  const cursor = requestedCursor ?? session?.legacyCursor ?? 0;
  if (!Number.isSafeInteger(cursor) || Number(cursor) < 0) throw new Error('无法读取终端，请重新打开。');
  if (!session?.exited) await session?.flow?.read(Number(cursor), token);
  const result = session?.output.read(Number(cursor))
    ?? { found: false, events: [], cursor: 0, truncated: false };
  session?.flow?.deliveredThrough(result.cursor);
  // Older phones consume arrays; cursor-aware phones can replay retained output after reconnecting.
  if (requestedCursor === undefined) {
    if (session) session.legacyCursor = result.cursor;
    return result.events;
  }
  return result;
}

// Independent of ChatHost resets, token refreshes and remote client lifetimes.
export const remoteTerminals = new RemoteTerminals();
