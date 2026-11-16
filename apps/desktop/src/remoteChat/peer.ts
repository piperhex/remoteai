import { MultipathPeer } from '../../../../shared/remote-chat/multipathPeer';
import { RtcPeer } from '../../../../shared/remote-chat/rtcPeer';
import type { PeerFactory } from '../../../../shared/remote-chat/protocol';
import { DesktopTcpNetwork } from './tcpNetwork';
import { createNativeRtcConnection } from '../nativeRtc/connection';

const rtc: PeerFactory = options => new RtcPeer(options,
  () => createNativeRtcConnection({ iceServers: options.iceServers }));

/** Both PC roles use the same negotiated paths; older peers keep their original RTC framing. */
export const createDesktopPeer: PeerFactory = options => {
  if (!options.tcp || !options.sessionId) return rtc(options);
  return new MultipathPeer(options, {
    rtc, network: new DesktopTcpNetwork(options.sessionId, options.generation ?? 0),
    random: size => crypto.getRandomValues(new Uint8Array(size)),
  });
};
