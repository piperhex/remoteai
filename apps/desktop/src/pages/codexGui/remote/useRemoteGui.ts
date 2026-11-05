import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ChatController } from '../../../../../../shared/remote-chat/client/controller';
import { ChatConnection } from '../../../../../../shared/remote-chat/client/connection';
import { useActiveChatPolicy } from '../../../../../../shared/remote-chat/useActiveChatPolicy';
import { createDesktopPeer } from '../../../remoteChat/peer';
import { createDesktopNativePath } from '../../../remoteChat/nativePath';
import { createDesktopPacketCompression } from '../../../remoteChat/packetCompression';
import { NativeGuiSocket } from './nativeSocket';
import { createDesktopSshProfiles } from '../../../api/sshProfiles';
import { registerDesktopMappingStream } from '../portForwarding/streamBridge';
import type { GuiCloudIdentity } from '../../../../../../shared/conversation/remote/types';
import { browserTrustStore, trustedHost, trustScope } from '../../../../../../shared/remote-chat/trustedHost';

const HISTORY_REFRESH_MS = 15_000;

export function useRemoteGui(identity: GuiCloudIdentity, deviceId: string, active: boolean) {
  const controller = useMemo(() => new ChatController((events) => new ChatConnection({
    ...events, deviceId, tcpPunch: true, managePolicyMode: false,
    verifyHostKey: trustedHost(browserTrustStore, trustScope(identity.baseUrl, deviceId)),
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    authorize: async () => ({ baseUrl: identity.baseUrl, accessToken: '' }),
    createSocket: () => new NativeGuiSocket(identity),
    createPeer: createDesktopPeer,
    createNativePath: createDesktopNativePath,
    createPacketCompression: createDesktopPacketCompression,
    registerMappingStream: registerDesktopMappingStream,
  }), undefined, undefined, createDesktopSshProfiles(identity)), [identity.baseUrl, identity.userId, deviceId]);
  controller.deferToolDetails = true;
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useActiveChatPolicy(active, state.mode);
  useEffect(() => { controller.start(); return () => controller.stop(); }, [controller]);
  useEffect(() => {
    if (!active || !state.ready) return;
    const refresh = () => { void controller.refreshSelected(); };
    refresh();
    const timer = setInterval(refresh, HISTORY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, state.ready, controller]);
  return { controller, state, foreground: true };
}
