import type { Channel } from './protocol';
import { NativeBulkChannel } from './nativeBulkChannel';
import type { ConnectionDiagnostic } from './diagnostics';
import { sanitizeDiagnostic, type DiagnosticFields } from './diagnosticSchema';
import type { NativeMediaEndpoint, NativeMediaRoute, NativeMediaSession } from '../remote-desktop/nativeMedia';
import { connectionEndpoint, type ConnectionEndpoints } from './connectionEndpoints';
import { ChannelBackpressureError } from './channelBackpressure';

export interface NativeTraversalConfig { secret: string; servers: string[]; stunServers: string[]; expiresAt: number }
export interface NativePathOptions {
  sessionId: string; desktop: boolean; config: NativeTraversalConfig; diagnostic?: ConnectionDiagnostic;
  bulkChannel?: import('./protocol').PeerOptions['bulkChannel'];
}
export interface NativeChannel extends Channel {
  renew(expiresAt: number): void;
  openMedia?(viewId: string): Promise<NativeMediaSession | undefined>;
}
export type NativePathFactory = (options: NativePathOptions) => NativeChannel;
export type NativePathEvent = { type: 'open' | 'closed' } | { type: 'data'; text: string }
  | { type: 'bulk'; generation: number }
  | { type: 'diagnostic'; stage: import('./diagnostics').DiagnosticFields['stage'];
    snapshot: Pick<import('./diagnostics').DiagnosticFields, 'elapsedMs' | 'connectedPeers' | 'routeCount'
      | 'remoteKnown' | 'direct' | 'udpNatType' | 'tcpNatType' | 'diagnosticVersion' | 'suppressed'> }
  | { type: 'punch'; report: Pick<DiagnosticFields, 'strategy' | 'stage' | 'phase' | 'reason' | 'udpNatType'
      | 'peerUdpNatType' | 'attempt' | 'durationMs' | 'sockets' | 'predictedPorts' | 'probesSent' | 'probesReceived'
      | 'matchedProbes' | 'rejectedProbes' | 'probeSendErrors' | 'probeReceiveErrors'
      | 'handshakeAttempts' | 'handshakeFailures'> }
  | { type: 'status'; route: { direct: boolean; protocol?: string; ipv6: boolean; rttMs?: number;
    localEndpoint?: { host: string; port: number } | null; remoteEndpoint?: { host: string; port: number } | null } };
export interface NativePathBridge {
  open(options: NativePathOptions, event: (event: NativePathEvent) => void): Promise<string>;
  send(id: string, text: string): Promise<void>;
  bulkSend?(id: string, generation: number, records: readonly Uint8Array[]): Promise<void>;
  close(id: string): Promise<void>;
  renew?(id: string, expiresAt: number): Promise<void>;
  mediaOpen?(id: string, viewId: string): Promise<NativeMediaEndpoint>;
  mediaStatus?(id: string, viewId: string): Promise<NativeMediaRoute>;
  mediaClose?(id: string, viewId: string): Promise<void>;
}
const MAX_BUFFER = 512 * 1024;

/** The native engine persists across ICE generations and reports P2P only for a verified direct route. */
export class NativePath implements Channel {
  private endpoints?: ConnectionEndpoints;
  private state = 'connecting';
  private pending = 0;
  private outgoing = Promise.resolve();
  private readonly id: Promise<string>;
  private readonly opened = new Set<() => void>();
  private readonly closed = new Set<() => void>();
  private readonly messages = new Set<(text: string) => void>();
  private bulk?: NativeBulkChannel;

  constructor(private readonly options: NativePathOptions, private readonly bridge: NativePathBridge) {
    this.id = bridge.open(options, event => this.receive(event));
    void this.id.catch(() => {
      this.options.diagnostic?.('native-state', { transport: 'mesh', stage: 'engine-failed' });
      this.close();
    });
  }
  get readyState() { return this.state; }
  get connectionEndpoints() { return this.state === 'open' ? this.endpoints : undefined; }
  renew(expiresAt: number) {
    if (this.state === 'closed' || !Number.isSafeInteger(expiresAt)) return;
    void this.id.then(id => this.bridge.renew?.(id, expiresAt)).catch(() => this.close());
  }
  get bufferedAmount() { return this.pending; }
  async openMedia(viewId: string): Promise<NativeMediaSession | undefined> {
    if (this.state === 'closed' || !this.bridge.mediaOpen || !this.bridge.mediaStatus || !this.bridge.mediaClose) {
      return undefined;
    }
    const id = await this.id;
    if (this.state === 'closed') return undefined;
    const endpoint = await this.bridge.mediaOpen(id, viewId);
    const close = () => this.bridge.mediaClose!(id, viewId);
    if (this.state === 'closed') { await close(); return undefined; }
    return { endpoint, status: () => this.bridge.mediaStatus!(id, viewId), close };
  }
  onOpen(callback: () => void) { this.opened.add(callback); }
  onClose(callback: () => void) { this.closed.add(callback); }
  onMessage(callback: (text: string) => void) { this.messages.add(callback); }

  private receive(event: NativePathEvent) {
    if (this.state === 'closed') return;
    if (event.type === 'bulk') {
      this.bulk?.close(); this.bulk = undefined;
      if (event.generation > 0 && Number.isSafeInteger(event.generation) && this.options.bulkChannel) {
        const send = this.bridge.bulkSend;
        this.bulk = new NativeBulkChannel(send ? async records => send(await this.id, event.generation, records)
          : undefined);
        this.options.bulkChannel(this.bulk, 'native');
      }
      return;
    }
    if (event.type === 'punch') {
      this.options.diagnostic?.('native-punch', {
        ...sanitizeDiagnostic(event.report), scope: 'chat', transport: 'mesh', protocol: 'udp',
      });
      return;
    }
    if (event.type === 'diagnostic') {
      this.options.diagnostic?.('native-state', { ...event.snapshot, transport: 'mesh', stage: event.stage });
      return;
    }
    if (event.type === 'closed') { this.close(); return; }
    if (event.type === 'open') {
      this.state = 'open'; this.opened.forEach(callback => callback());
    } else if (event.type === 'data') {
      this.messages.forEach(callback => callback(event.text));
    } else if (event.type === 'status') {
      if (!event.route.direct) this.state = 'connecting';
      const { localEndpoint: local, remoteEndpoint: remote, protocol } = event.route;
      this.endpoints = event.route.direct ? {
        local: connectionEndpoint(local?.host, local?.port, protocol),
        remote: connectionEndpoint(remote?.host, remote?.port, protocol),
      } : undefined;
      this.options.diagnostic?.('path-state', { transport: 'mesh',
        state: event.route.direct ? 'connected' : 'disconnected',
        ipv6: event.route.ipv6, rttMs: event.route.rttMs });
    }
  }

  send(text: string) {
    const bytes = text.length * 2;
    if (this.state !== 'open') throw new Error('Direct path unavailable');
    if (this.pending + bytes > MAX_BUFFER) throw new ChannelBackpressureError();
    this.pending += bytes;
    this.outgoing = this.outgoing.then(async () => {
      const id = await this.id;
      if (this.state === 'open') await this.bridge.send(id, text);
    }).catch(() => this.close()).finally(() => { this.pending -= bytes; });
  }

  close() {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.bulk?.close(); this.bulk = undefined;
    void this.id.then(id => this.bridge.close(id)).catch(() => {
      // A native close or failed open has already released its session resources.
    });
    this.closed.forEach(callback => callback());
    this.opened.clear(); this.closed.clear(); this.messages.clear();
  }
}
