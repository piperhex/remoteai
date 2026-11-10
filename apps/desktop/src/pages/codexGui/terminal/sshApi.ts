import { Channel, invoke } from '@tauri-apps/api/core';
import type { SshApi, SshConnect, SshEndpoint, SshFileAction, SshFileReply,
  SshX11 } from '../../../../../../shared/terminal/ssh';
import type { TerminalEvent, TerminalInfo } from '../../../../../../shared/terminal/types';
import { TerminalOutput } from '../../../remoteChat/terminalOutput';
import { desktopSshProfiles } from '../../../api/sshProfiles';
import { isDesktopApp } from '../../../api/backend';

interface Attachment { output: TerminalOutput; listener?: (event: TerminalEvent) => void }
const attachments = new Map<string, Attachment>();

export function openNativeSsh(request: SshConnect, onEvent: (event: TerminalEvent) => void) {
  const channel = new Channel<TerminalEvent>();
  channel.onmessage = onEvent;
  return invoke<TerminalInfo>('codex_gui_ssh_open', { request, onEvent: channel });
}
export const probeSsh = (endpoint: SshEndpoint) => invoke<string>('codex_gui_ssh_probe', { endpoint });
export const ensureSshX11 = (options: SshX11) => invoke<void>('codex_gui_ssh_ensure_x11', { options });
export const sshFiles = (id: string, request: SshFileAction) =>
  invoke<SshFileReply>('codex_gui_ssh_files', { id, request });

export const sshApi: SshApi = {
  previewMode: isDesktopApp ? 'direct' : undefined,
  profiles: desktopSshProfiles,
  probe: probeSsh, files: sshFiles, ensureX11: ensureSshX11,
  async open(request, projectCwd) {
    const attachment: Attachment = { output: new TerminalOutput() };
    const info = await openNativeSsh(request, event => {
      attachment.output.push(event);
      attachment.listener?.(event);
    });
    attachments.set(info.id, attachment);
    return { ...info, projectCwd };
  },
};

export async function attachSsh(info: TerminalInfo, onEvent: (event: TerminalEvent) => void) {
  const attachment = attachments.get(info.id);
  if (!attachment) throw new Error('client.ssh.closed');
  attachment.listener = onEvent;
  let cursor = 0;
  for (;;) {
    const output = attachment.output.read(cursor);
    if (!output.events.length) break;
    output.events.forEach(event => onEvent(event)); cursor = output.cursor;
  }
  return { ...info, detach: () => {
    if (attachment.listener !== onEvent) return;
    attachment.listener = undefined;
    // React can immediately reattach effects in development; only an abandoned view owns the close.
    setTimeout(() => {
      if (!attachment.listener) void closeSsh(info.id).catch(() => console.error('SSH cleanup failed'));
    }, 0);
  } };
}

export async function closeSsh(id: string) {
  await invoke<void>('codex_gui_ssh_command', { request: { type: 'close', id } });
  attachments.delete(id);
}
