export const DIRECT_TIMEOUT_MS = 10_000;
// Leave room for timer/clock differences before the gateway's enforced direct-attempt deadline.
export const RELAY_START_GRACE_MS = 1000;
export const REQUEST_TIMEOUT_MS = 60_000;
export const MAX_MESSAGE_CHARS = 8 * 1024 * 1024;
export const MAX_BUFFER_BYTES = 512 * 1024;
export type ConnectionMode = 'connecting' | 'direct' | 'relay' | 'offline';
export type Signal = import('./tcp/types').TcpSignal
  | { kind: 'key'; key: string; identity?: { key: string; signature: string } }
  | { kind: 'sdp'; type: 'offer' | 'answer'; sdp: string }
  | { kind: 'ice'; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };
export interface IceServer { urls: string | string[]; username?: string; credential?: string; nativeMedia?: boolean }
export interface Channel {
  readonly connectionEndpoints?: import('./connectionEndpoints').ConnectionEndpoints;
  readonly readyState: string;
  readonly bufferedAmount: number;
  send(data: string): void;
  close(): void;
  onOpen(callback: () => void): void;
  onClose(callback: () => void): void;
  /** Multiplexers pass the receiving path's addresses; an empty object means that path's addresses are unknown. */
  onMessage(callback: (data: string, endpoints?: import('./connectionEndpoints').ConnectionEndpoints) => void): void;
}
export interface Peer {
  offer(): Promise<void>;
  accept(signal: Exclude<Signal, { kind: 'key' }>): Promise<void>;
  close(): void;
}
export type PeerConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';
export interface PeerOptions {
  bulkChannel?: (channel: import('./bulkTransport').BinaryChannel) => void;
  diagnostic?: import('./diagnostics').ConnectionDiagnostic;
  sessionId?: string;
  desktop?: boolean;
  generation?: number;
  tcp?: import('./tcp/types').TcpPunchConfig;
  iceServers: IceServer[];
  signal: (signal: Signal) => void;
  channel: (channel: Channel) => void;
  disconnected: () => void;
  stateChanged?: (state: PeerConnectionState) => void;
}
export type PeerFactory = (options: PeerOptions) => Peer;
export interface RpcRequest { kind: 'request'; id: string; method: 'connect' | 'request' | 'respond'; body?: unknown }
export interface RpcResponse { kind: 'response'; id: string; data?: unknown; error?: string }
export interface RpcEvent { kind: 'event'; event: unknown }
export type RpcMessage = RpcRequest | RpcResponse | RpcEvent;

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('连接数据无效，请重新连接。');
  return value as Record<string, unknown>;
}

export function parseMessage(value: string): Record<string, unknown> {
  return object(JSON.parse(value) as unknown);
}

export function chatSocketUrl(base: string) {
  const url = new URL(base);
  if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol === 'http:') url.protocol = 'ws:';
  else throw new Error('请使用有效的服务器地址。');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/device-chat`;
  url.search = '';
  url.hash = '';
  return url.toString();
}
