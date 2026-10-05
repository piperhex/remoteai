import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { trustedHost, trustScope } from '../../../../shared/remote-chat/trustedHost';
import { NativeModules, Platform } from 'react-native';
import { nativeDownloadSocket } from './downloadSocket';
import { RTCPeerConnection as NativePeerConnection } from 'react-native-webrtc';
import { fetchUserProfile, refreshSession } from '../api/client';
import type { AuthSession } from '../types';
import { ChatConnection, type ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import { RtcPeer } from '../../../../shared/remote-chat/rtcPeer';
import { createNativePacketCipher } from './packetCipher';
import { MultipathPeer } from '../../../../shared/remote-chat/multipathPeer';
import { NativeTcpNetwork } from './tcpNetwork';
import { createMobileNativePath } from './nativePath';
import type { PeerFactory } from '../../../../shared/remote-chat/protocol';

interface Options extends ConnectionEvents { session: AuthSession; deviceId: string }
const rtc: PeerFactory = peer => new RtcPeer(peer, () => (
  new NativePeerConnection({ iceServers: peer.iceServers }) as unknown as RTCPeerConnection));

export class MobileChatConnection extends ChatConnection {
  constructor({ session, ...options }: Options) {
    super({ ...options, randomBytes: getRandomBytes,
      binaryBulk: Platform.OS === 'android' && NativeModules.FileDownloads?.bulkBinaryAvailable === true,
      createSocket: Platform.OS === 'android' && NativeModules.DownloadChatSocket ? nativeDownloadSocket : undefined,
      bulkFailure: (id, epoch, code) => { void NativeModules.FileDownloads?.failBulk(id, epoch, code); },
      verifyHostKey: trustedHost({ read: SecureStore.getItemAsync, save: SecureStore.setItemAsync },
        trustScope(session.baseUrl, options.deviceId)),
      tcpPunch: Platform.OS === 'android' || Platform.OS === 'ios',
      createNativePath: createMobileNativePath,
      createPacketCipher: createNativePacketCipher,
      clientInfo: { name: Platform.OS === 'android' ? Platform.constants.Model : 'iPhone / iPad',
        platform: Platform.OS === 'android' ? 'Android' : 'iOS' },
      authorize: async () => { await fetchUserProfile(session); return session; },
      renewAuthorization: async () => { await refreshSession(session); },
      // Native WebRTC implements the browser subset, but ships independent TypeScript declarations.
      createPeer: peer => peer.tcp ? new MultipathPeer(peer,
        { rtc, network: new NativeTcpNetwork(), random: getRandomBytes }) : rtc(peer),
    });
  }
}
