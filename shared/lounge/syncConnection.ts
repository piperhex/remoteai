import { ChatLink } from '../remote-chat/link';
import { keyPair } from '../remote-chat/cipher';
import { browserChatSocket, type ChatSocket } from '../remote-chat/client/socket';
import { chatSocketUrl, type IceServer, type Signal } from '../remote-chat/protocol';
import type { LinkOptions } from '../remote-chat/linkOptions';
import { RelayQuota } from '../remote-chat/relayUsage';
import { setChatPolicy } from '../remote-chat/policy';
import { HistoryExchange } from './syncExchange';
import { HistoryAccess } from './syncAccess';
import type { SyncArchive } from './syncArchive';
import { ReconnectBackoff } from '../realtime/reconnectBackoff';

const RENEW_MS = 4 * 60_000;
const CONNECT_MS = 15_000;
export interface LoungeSyncTransport {
  retryRandom?: () => number;
  randomBytes: (length: number) => Uint8Array;
  createPeer: LinkOptions['createPeer'];
  createPacketCipher?: LinkOptions['createPacketCipher'];
  createPacketCompression?: LinkOptions['createPacketCompression'];
  createSocket?: (url: string) => ChatSocket;
}
interface SyncPeer { link: ChatLink; exchange: HistoryExchange; started: boolean }

/** Same-account sessions use the existing /device-chat binary relay and encrypted P2P transport. */
export class HistorySyncConnection {
  private active = false;
  private generation = 0;
  private readonly backoff: ReconnectBackoff;
  private socket?: ChatSocket;
  private keys?: ReturnType<typeof keyPair>;
  private retry?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private renewal?: ReturnType<typeof setTimeout>;
  private readonly peers = new Map<string, SyncPeer>();
  private quota = new RelayQuota();
  private readonly access = new HistoryAccess(frame => this.send(frame));

  constructor(private readonly options: {
    baseUrl: string; deviceId: string; transport: LoungeSyncTransport; archive: SyncArchive;
    authorize: () => Promise<{ ticket: string }>; error: (failed: boolean) => void;
  }) { this.backoff = new ReconnectBackoff({ random: options.transport.retryRandom }); }

  start() { if (!this.active) { this.active = true; void this.connect(); } }
  retryNow() { if (this.active && this.retry) { this.reset(); void this.connect(); } }
  changed(key: string) { for (const peer of this.peers.values()) peer.exchange.changedHere(key); }

  private async connect() {
    if (!this.active) return;
    const generation = ++this.generation;
    this.deadline = setTimeout(() => this.failed(), CONNECT_MS);
    try {
      const { ticket } = await this.options.authorize();
      if (!this.active || generation !== this.generation) return;
      this.keys = keyPair(this.options.transport.randomBytes);
      const socket = (this.options.transport.createSocket ?? browserChatSocket)(chatSocketUrl(this.options.baseUrl));
      this.socket = socket;
      socket.onopen = () => this.send({ type: 'authenticate', role: 'lounge', accessToken: ticket,
        deviceId: this.options.deviceId, publicKey: this.keys!.publicKey, transportVersion: 2, binaryRelay: true });
      socket.onmessage = event => { if (this.socket === socket) this.receive(event.data); };
      socket.onclose = socket.onerror = () => { if (this.socket === socket) this.failed(); };
    } catch { if (this.active && generation === this.generation) this.failed(); }
  }

  private send(frame: object) {
    if (!this.socket || this.socket.readyState !== 1) throw new Error('history-sync-disconnected');
    this.socket.send(JSON.stringify(frame));
  }

  private receive(data: unknown) {
    try {
      if (typeof data !== 'string' || data.length > 64 * 1024) throw new Error('invalid-history-control');
      const frame = JSON.parse(data) as Record<string, unknown>;
      if (!frame || typeof frame !== 'object') throw new Error('invalid-history-control');
      if (this.access.receive(frame)) return;
      if (this.quota.receive(frame)) {
        for (const peer of this.peers.values()) peer.link.setRelayQuotaBlocked(this.quota.blocked);
        return;
      }
      this.control(frame);
    } catch { this.failed(); }
  }

  private control(frame: Record<string, unknown>) {
    if (frame.type === 'chat-policy') { setChatPolicy(frame.policy); return; }
    if (frame.type === 'sync-registered' || frame.type === 'auth-renewed') {
      clearTimeout(this.deadline); clearTimeout(this.renewal); this.backoff.reset();
      this.options.error(false); this.renewal = setTimeout(() => void this.renew(), RENEW_MS); return;
    }
    if (frame.type === 'sync-peer') { this.pair(frame); return; }
    const id = String(frame.sessionId);
    const peer = this.peers.get(id);
    if (!peer) return;
    if (frame.type === 'relay' && typeof frame.payload === 'string') peer.link.receive(frame.payload);
    if (frame.type === 'signal') void peer.link.acceptSignal(frame.payload as Signal).catch(() => this.failed());
    if (frame.type === 'sync-lease' && typeof frame.expiresAt === 'number') peer.link.renew(frame.expiresAt);
    if (frame.type === 'peer-close') { peer.exchange.close(); peer.link.close(); this.peers.delete(id); }
  }

  private pair(frame: Record<string, unknown>) {
    const id = frame.sessionId;
    if (typeof id !== 'string' || this.peers.has(id) || this.peers.size >= 15 || !this.keys
      || typeof frame.publicKey !== 'string' || typeof frame.desktop !== 'boolean'
      || !Array.isArray(frame.iceServers) || typeof frame.expiresAt !== 'number') throw new Error('invalid-history-peer');
    const peer = {} as SyncPeer;
    peer.exchange = new HistoryExchange({ archive: this.options.archive, access: this.access,
      send: message => peer.link.send(message), failed: () => this.failed() });
    peer.link = new ChatLink({ ...this.options.transport, sessionId: id, secret: this.keys.secret,
      publicKey: frame.publicKey, desktop: frame.desktop, transportVersion: 2,
      iceServers: frame.iceServers as IceServer[], signal: message => this.send(message),
      relayBuffered: () => this.socket?.bufferedAmount ?? 0, error: () => this.failed(),
      reconnectRelay: () => this.failed(), message: message => peer.exchange.receive(message),
      mode: mode => {
        if ((mode === 'direct' || mode === 'relay') && !peer.started) { peer.started = true; peer.exchange.start(); }
      } });
    peer.link.renew(frame.expiresAt); peer.link.setRelayQuotaBlocked(this.quota.blocked);
    this.peers.set(id, peer);
    if (!frame.desktop) void peer.link.offer();
  }

  private async renew() {
    const generation = this.generation;
    this.deadline = setTimeout(() => this.failed(), CONNECT_MS);
    try {
      const { ticket } = await this.options.authorize();
      if (this.active && generation === this.generation) this.send({ type: 'renew-auth', accessToken: ticket });
    } catch { if (this.active && generation === this.generation) this.failed(); }
  }

  private failed() {
    if (!this.active) return;
    this.reset(); this.options.error(true);
    if (!this.active) return;
    this.retry = setTimeout(() => { this.retry = undefined; void this.connect(); }, this.backoff.next());
  }

  private reset() {
    this.generation++; clearTimeout(this.retry); clearTimeout(this.deadline); clearTimeout(this.renewal);
    this.retry = undefined;
    const socket = this.socket; this.socket = undefined;
    if (socket) { socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null; socket.close(); }
    for (const peer of this.peers.values()) { peer.exchange.close(); peer.link.close(); }
    this.peers.clear(); this.access.close(); this.quota = new RelayQuota();
    this.keys?.secret.fill(0); this.keys = undefined;
  }

  stop() { this.active = false; this.reset(); }
}
