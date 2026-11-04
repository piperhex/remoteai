import { useMemo } from 'react';
import { DownloadsPage } from '../src/pages/DownloadsPage';
import { useDesktopDownloads } from '../src/downloads/useDesktopDownloads';
import { DownloadManagerPage } from '../../web/src/downloads/DownloadManagerPage';
import { useDownloadConnection } from '../../../shared/downloads/useDownloadConnection';
import { downloadOwner } from '../../../shared/downloads/manager';
import { initialChatState } from '../../../shared/remote-chat/client/types';
import type { GuiToolsClient } from '../../../shared/remote-chat/guiTools';
import type { DownloadClient } from '../../../shared/remote-chat/downloads';
import type { AuthSession } from '../../web/src/types';

const identity = { baseUrl: 'https://ssh-download.test', userId: 'ssh-owner' };
const auth = { ...identity, enabled: true, authenticated: true, sessionExpired: false };
const session = { ...identity, email: 'ssh@test.example' } as AuthSession;
const device = { deviceId: 'ssh-host', name: 'SSH computer', platform: 'windows', online: true };
const unavailable = async (): Promise<never> => { throw new Error('SSH must use its own file transport'); };
const downloads: DownloadClient = { open: unavailable, read: unavailable, close: unavailable, browse: unavailable };
const files = { open: unavailable, read: unavailable, close: unavailable };

function fixtureController(guiTools: GuiToolsClient) {
  const state = { ...initialChatState(), ready: true, mode: 'direct' as const };
  return { guiTools, downloads, files, snapshot: () => state, subscribe: () => () => {} };
}

export function SshDownloadConnection({ mode, client }: { mode: string; client: GuiToolsClient }) {
  const controller = useMemo(() => fixtureController(client), [client]);
  return mode === 'web' ? <WebConnection controller={controller} />
    : mode === 'remote' ? <RemoteConnection controller={controller} /> : null;
}

function WebConnection({ controller }: { controller: ReturnType<typeof fixtureController> }) {
  useDownloadConnection({ session, ...device, deviceName: device.name, controller });
  return null;
}

function RemoteConnection({ controller }: { controller: ReturnType<typeof fixtureController> }) {
  useDesktopDownloads({ identity, device, controller });
  return null;
}

export function SshDownloadsPage({ mode, back }: { mode: string; back: () => void }) {
  return mode === 'web' ? <DownloadManagerPage owner={downloadOwner(session)} onBack={back} />
    : <DownloadsPage auth={auth} />;
}
