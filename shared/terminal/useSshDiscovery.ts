import { useState } from 'react';
import type { GuiToolsClient } from '../remote-chat/guiTools';
import { useRemoteTerminalPanel } from '../remote-chat/useRemoteTerminalPanel';
import { useSshProfiles } from './useSshProfiles';
import type { SshProfile } from './sshProfiles';

/** Discovery opens SSH directly; the host supplies either a phone transport or a computer transport. */
export function useSshDiscovery(client: GuiToolsClient['terminal'], connected: boolean, direct = false) {
  const saved = useSshProfiles(client.ssh.profiles);
  const [profile, choose] = useState<SshProfile>();
  const [editor, setEditor] = useState<{ profile?: SshProfile }>();
  const panel = useRemoteTerminalPanel({ client, cwd: '', connected,
    ...(direct ? { errorKey: 'client.ssh.connectionFailed' } : {}) });
  return { saved, profile, choose, close: () => choose(undefined),
    editor, edit: (value?: SshProfile) => setEditor({ profile: value }),
    closeEditor: () => { setEditor(undefined); void saved.refresh(); },
    panel: { ...panel, retry: panel.toggle } };
}
