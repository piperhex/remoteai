export interface NativeRtcHandle { peer: string; channel: string }
export interface ChannelSpec { key: string; label: string; negotiated?: number | null }
export type NativeRtcEvent =
  | { kind: 'candidate'; candidate: RTCIceCandidateInit }
  | { kind: 'state'; state: RTCPeerConnectionState }
  | { kind: 'gathering'; state: RTCIceGatheringState; description?: RTCSessionDescriptionInit }
  | { kind: 'channel'; channel: ChannelSpec }
  | { kind: 'open' | 'close'; key: string }
  | { kind: 'text'; key: string; text: string }
  | { kind: 'binaryReady' | 'closed' };
export type NativeRtcOperation =
  | { kind: 'offer' | 'answer' | 'stats' | 'keyFrame' }
  | { kind: 'local' | 'remote'; description: RTCSessionDescriptionInit }
  | { kind: 'candidate'; candidate: RTCIceCandidateInit }
  | { kind: 'createChannel'; channel: ChannelSpec }
  | { kind: 'closeChannel'; key: string };
export type BinaryHeader = { kind: 'data'; key: string }
  | { kind: 'media'; track: string; codec: string; timestamp: number; keyframe: boolean;
    sampleRate: number; channels: number };

export interface ChannelBackend {
  readonly id?: string;
  send(key: string, bytes: Uint8Array, text: boolean): Promise<void>;
  perform<T>(operation: NativeRtcOperation): Promise<T>;
}
