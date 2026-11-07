import { useEffect, useMemo } from 'react';
import { invoke } from '../../api/backend';
import { ChatConnection } from '../../../../../shared/remote-chat/client/connection';
import { remoteSyncHost } from '../../../../../shared/conversation/sync/remote';
import type { SyncHost } from '../../../../../shared/conversation/sync/types';
import type { GuiCloudIdentity, GuiComputer } from '../../../../../shared/conversation/remote/types';
import { browserTrustStore, trustedHost, trustScope } from '../../../../../shared/remote-chat/trustedHost';
import { createDesktopPeer } from '../../remoteChat/peer';
import { createDesktopNativePath } from '../../remoteChat/nativePath';
import { createDesktopPacketCompression } from '../../remoteChat/packetCompression';
import { NativeGuiSocket } from './remote/nativeSocket';

export interface SyncComputerDirectory { identity: GuiCloudIdentity | null; devices: GuiComputer[] }

export function useDesktopSyncHosts(directory?: SyncComputerDirectory) {
  const identity = directory?.identity;
  const devices = JSON.stringify(directory?.devices.filter(device => device.online)
    .map(({ deviceId, name }) => ({ deviceId, name })) ?? []);
  const hosts = useMemo<SyncHost[]>(() => {
    const local: SyncHost = { id: 'local', name: '',
      request: request => invoke('codex_conversation_sync', { request }) };
    if (!identity) return [local];
    const online = JSON.parse(devices) as Pick<GuiComputer, 'deviceId' | 'name'>[];
    return [local, ...online.map(device => remoteSyncHost({ id: device.deviceId, name: device.name,
      connect: events => new ChatConnection({ ...events, deviceId: device.deviceId, managePolicyMode: false,
        tcpPunch: true, randomBytes: length => crypto.getRandomValues(new Uint8Array(length)),
        authorize: async () => ({ baseUrl: identity.baseUrl, accessToken: '' }),
        createSocket: () => new NativeGuiSocket(identity), createPeer: createDesktopPeer,
        createNativePath: createDesktopNativePath, createPacketCompression: createDesktopPacketCompression,
        verifyHostKey: trustedHost(browserTrustStore, trustScope(identity.baseUrl, device.deviceId)),
      }),
    }))];
  }, [identity?.baseUrl, identity?.userId, devices]);
  useEffect(() => () => { hosts.forEach(host => host.close?.()); }, [hosts]);
  return hosts;
}
