import { ChatConnection, type ConnectionEvents } from '../../../../../../shared/remote-chat/client/connection';
import { createDesktopPeer } from '../../../remoteChat/peer';
import { desktopSessionCrypto } from '../../../remoteChat/sessionCipher';
import { createDesktopNativePath } from '../../../remoteChat/nativePath';
import { createDesktopPacketCompression } from '../../../remoteChat/packetCompression';
import { NativeGuiSocket } from './nativeSocket';
import { NativeFileSocket } from '../../../remoteChat/fileSocket';
import { registerDesktopMappingStream } from '../portForwarding/streamBridge';
import { browserTrustStore, trustedHost, trustScope } from '../../../../../../shared/remote-chat/trustedHost';
import type { GuiCloudIdentity } from '../../../../../../shared/conversation/remote/types';

export function desktopChatConnection(identity: GuiCloudIdentity, deviceId: string, events: ConnectionEvents) {
  return new ChatConnection({
    ...events, ...desktopSessionCrypto, deviceId, tcpPunch: true, managePolicyMode: false,
    verifyHostKey: trustedHost(browserTrustStore, trustScope(identity.baseUrl, deviceId)),
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    authorize: async () => ({ baseUrl: identity.baseUrl, accessToken: '' }),
    createSocket: () => new NativeGuiSocket(identity),
    createFileSocket: () => new NativeFileSocket(),
    createPeer: createDesktopPeer,
    createNativePath: createDesktopNativePath,
    createPacketCompression: createDesktopPacketCompression,
    registerMappingStream: registerDesktopMappingStream,
  });
}
