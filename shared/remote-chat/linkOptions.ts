import type { ConnectionMode, IceServer, PeerFactory, RpcMessage } from './protocol';
import type { PacketCipherFactory } from './packetCipher';

export interface LinkOptions {
  binaryBulk?: boolean;
  bulkRelay?: import('./bulkTransport').BulkRelay;
  directEndpoints?: (value?: import('./connectionEndpoints').ConnectionEndpoints) => void;
  sessionId: string;
  desktop: boolean;
  secret: Uint8Array;
  publicKey?: string;
  iceServers: IceServer[];
  tcp?: import('./tcp/types').TcpPunchConfig;
  nativeTraversal?: import('./nativePath').NativeTraversalConfig;
  createNativePath?: import('./nativePath').NativePathFactory;
  createPeer: PeerFactory;
  createPacketCipher?: PacketCipherFactory;
  signal: (message: object) => void;
  relayBuffered: () => number;
  message: (message: RpcMessage) => void;
  mode: (mode: ConnectionMode) => void;
  error: (message: string) => void;
  transportVersion?: number;
  reconnectRelay?: () => void;
  diagnosticsEnabled?: () => boolean;
}
