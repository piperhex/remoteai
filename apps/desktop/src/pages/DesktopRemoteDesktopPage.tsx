import { useCallback } from 'react';
import type { GuiCloudIdentity, GuiComputerNavigation } from '../../../../shared/conversation/remote/types';
import { localDesktopClipboard } from '../../../../shared/remote-desktop/local/localClipboard';
import { RemoteDesktopPage } from '../../../../shared/remote-desktop/views/RemoteDesktopPage';
import type { ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import { desktopChatConnection } from './codexGui/remote/desktopChatConnection';

export default function DesktopRemoteDesktopPage({ computers }: {
  computers: GuiComputerNavigation & { identity: GuiCloudIdentity | null };
}) {
  const { baseUrl, userId } = computers.identity ?? {};
  const connect = useCallback((deviceId: string, events: ConnectionEvents) => {
    if (!baseUrl || !userId) throw new Error('client.app.pleaseSignInFirst');
    return desktopChatConnection({ baseUrl, userId }, deviceId, events);
  }, [baseUrl, userId]);
  return <RemoteDesktopPage devices={computers.devices} directory={computers} connect={connect}
    login={computers.authenticated ? undefined : computers.login} localClipboard={localDesktopClipboard} />;
}
