import { ChatLink } from '../remote-chat/link';
import { keyPair } from '../remote-chat/cipher';
import { browserChatSocket, type ChatSocket } from '../remote-chat/client/socket';
import { chatSocketUrl, type IceServer, type Signal } from '../remote-chat/protocol';
import { RelayQuota } from '../remote-chat/relayUsage';
import { setChatPolicy } from '../remote-chat/policy';
import { AttachmentExchange } from './attachmentExchange';
import type { AttachmentSource, LoungeAttachment } from './attachments';
import type { LoungeSyncTransport } from './syncConnection';
import { ReconnectBackoff } from '../realtime/reconnectBackoff';

const CONNECT_MS = 20_000;
const RENEW_MS = 4 * 60_000;
interface TransferPeer { link: ChatLink; exchange: AttachmentExchange }
interface Pending {
  resolve: (value: TransferPeer) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>;
  cleanup: () => void;
}

/** Existing transport v2 starts on relay, upgrades to P2P and keeps relay heartbeats alive as fallback. */
export class AttachmentConnection {
  private readonly backoff: ReconnectBackoff;
  private socket?: ChatSocket;
  private keys?: ReturnType<typeof keyPair>;
  private active = false;
  private epoch = 0;
  private ready = false;
  private retry?: ReturnType<typeof setTimeout>;
  private renewal?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private quota = new RelayQuota();
  private readonly peers = new Map<string, TransferPeer>();
  private readonly pending = new Map<string, Pending>();
  constructor(private readonly options: {
    baseUrl: string; deviceId: string; transport: LoungeSyncTransport;
    authorize: () => Promise<{ ticket: string }>;
    source: (id: string) => Promise<AttachmentSource | undefined>;
  }) { this.backoff = new ReconnectBackoff({ initialMs: 2000, random: options.transport.retryRandom }); }
  start() { if (!this.active) { this.active = true; void this.connect(); } }
  retryNow() { if (this.active && this.retry) { this.reset(); void this.connect(); } }
  private async connect() {
    if (!this.active) return;
    const epoch = ++this.epoch;
    this.deadline = setTimeout(() => this.failed(), CONNECT_MS);
    try {
      const { ticket } = await this.options.authorize();
      if (!this.active || epoch !== this.epoch) return;
      this.keys = keyPair(this.options.transport.randomBytes);
      const socket = (this.options.transport.createSocket ?? browserChatSocket)(chatSocketUrl(this.options.baseUrl));
      this.socket = socket;
      socket.onopen = () => this.send({ type: 'authenticate', role: 'lounge', purpose: 'attachments',
        deviceId: this.options.deviceId, accessToken: ticket, publicKey: this.keys!.publicKey,
        transportVersion: 2, binaryRelay: true, attachmentRecovery: true });
      socket.onmessage = event => { if (this.socket === socket) this.receive(event.data); };
      socket.onclose = socket.onerror = () => { if (this.socket === socket) this.failed(); };
    } catch { if (this.active && epoch === this.epoch) this.failed(); }
  }
  private send(frame: object) {
    if (this.socket?.readyState !== 1) throw new Error('client.lounge.fileUnavailable');
    this.socket.send(JSON.stringify(frame));
  }
  private receive(data: unknown) {
    try {
      if (typeof data !== 'string' || data.length > 64 * 1024) throw new Error('invalid-frame');
      const frame = JSON.parse(data) as Record<string, unknown>;
      if (this.quota.receive(frame)) {
        for (const peer of this.peers.values()) peer.link.setRelayQuotaBlocked(this.quota.blocked);
        return;
      }
      this.control(frame);
    } catch { this.failed(); }
  }
  private control(frame: Record<string, unknown>) {
    if (frame.type === 'attachment-locate') { void this.locate(frame); return; }
    if (frame.type === 'chat-policy') { setChatPolicy(frame.policy); return; }
    if (frame.type === 'sync-registered' || frame.type === 'auth-renewed') {
      clearTimeout(this.deadline); clearTimeout(this.renewal); this.ready = true;
      this.backoff.reset();
      this.renewal = setTimeout(() => void this.renew(), RENEW_MS); return;
    }
    if (frame.type === 'attachment-peer') { this.pair(frame); return; }
    if (frame.type === 'attachment-unavailable') { this.reject(String(frame.id)); return; }
    const id = String(frame.sessionId), peer = this.peers.get(id);
    if (!peer) return;
    if (frame.type === 'relay' && typeof frame.payload === 'string') peer.link.receive(frame.payload);
    if (frame.type === 'signal') void peer.link.acceptSignal(frame.payload as Signal).catch(() => this.failed());
    if (frame.type === 'sync-lease' && typeof frame.expiresAt === 'number') peer.link.renew(frame.expiresAt);
    if (frame.type === 'peer-close') { peer.exchange.close(); peer.link.close(); this.peers.delete(id); }
  }
  private async locate(frame: Record<string, unknown>) {
    if (typeof frame.id !== 'string' || typeof frame.fileId !== 'string') return;
    const socket = this.socket;
    const source = await this.options.source(frame.fileId).catch(() => undefined);
    if (this.socket !== socket) return;
    try { this.send({ type: 'attachment-available', id: frame.id, available: !!source }); }
    catch { /* A disconnected socket will be registered again by the reconnect loop. */ }
  }
  private pair(frame: Record<string, unknown>) {
    const id = String(frame.sessionId), fileId = String(frame.fileId);
    const pending = this.pending.get(String(frame.id));
    if (frame.desktop === false && !pending) { this.send({ type: 'peer-close', sessionId: id }); return; }
    if (this.peers.has(id) || this.peers.size >= 16 || !this.keys || typeof frame.publicKey !== 'string'
      || typeof frame.desktop !== 'boolean' || !Array.isArray(frame.iceServers)
      || typeof frame.expiresAt !== 'number') throw new Error('invalid-peer');
    const peer = {} as TransferPeer;
    peer.exchange = new AttachmentExchange({ fileId, source: () => this.options.source(fileId),
      send: message => peer.link.send(message) });
    peer.link = new ChatLink({ ...this.options.transport, sessionId: id, secret: this.keys.secret,
      publicKey: frame.publicKey, desktop: frame.desktop, transportVersion: 2, startOnRelay: true,
      iceServers: frame.iceServers as IceServer[], signal: message => this.send(message),
      relayBuffered: () => this.socket?.bufferedAmount ?? 0, error: () => this.failed(),
      reconnectRelay: () => this.failed(), message: message => peer.exchange.receive(message), mode: () => {} });
    peer.link.renew(frame.expiresAt); peer.link.setRelayQuotaBlocked(this.quota.blocked);
    this.peers.set(id, peer);
    if (!frame.desktop && pending) {
      clearTimeout(pending.timer); pending.cleanup(); this.pending.delete(String(frame.id)); pending.resolve(peer);
    }
    if (!frame.desktop) void peer.link.offer();
  }
  async open(file: LoungeAttachment, signal?: AbortSignal): Promise<TransferPeer> {
    if (!signal?.aborted) this.retryNow();
    const started = Date.now();
    while (this.active && !this.ready && Date.now() - started < CONNECT_MS) {
      if (signal?.aborted) throw new Error('client.lounge.fileUnavailable');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!this.ready || !file.grant || signal?.aborted) throw new Error('client.lounge.fileUnavailable');
    return new Promise((resolve, reject) => {
      if (this.pending.has(file.id)) { reject(new Error('client.lounge.fileUnavailable')); return; }
      const cancel = () => this.reject(file.id);
      this.pending.set(file.id, { resolve, reject, timer: setTimeout(cancel, CONNECT_MS),
        cleanup: () => signal?.removeEventListener('abort', cancel) });
      signal?.addEventListener('abort', cancel, { once: true });
      try { this.send({ type: 'attachment-connect', id: file.id, grant: file.grant }); }
      catch { this.reject(file.id); }
    });
  }
  release(peer: TransferPeer) {
    for (const [id, value] of this.peers) if (value === peer) {
      try { this.send({ type: 'peer-close', sessionId: id }); } catch { /* Socket close also revokes the pair. */ }
      this.peers.delete(id);
    }
    peer.exchange.close(); peer.link.close();
  }
  private reject(id: string) {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer); pending.cleanup(); this.pending.delete(id);
    pending.reject(new Error('client.lounge.fileUnavailable'));
  }
  private async renew() {
    const epoch = this.epoch;
    this.deadline = setTimeout(() => this.failed(), CONNECT_MS);
    try {
      const { ticket } = await this.options.authorize();
      if (this.active && epoch === this.epoch) this.send({ type: 'renew-auth', accessToken: ticket });
    } catch { if (this.active && epoch === this.epoch) this.failed(); }
  }
  private failed() {
    if (!this.active) return;
    this.reset();
    this.retry = setTimeout(() => { this.retry = undefined; void this.connect(); }, this.backoff.next());
  }
  private reset() {
    this.epoch++; this.ready = false;
    clearTimeout(this.retry); clearTimeout(this.renewal); clearTimeout(this.deadline);
    this.retry = undefined;
    const socket = this.socket; this.socket = undefined;
    if (socket) { socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null; socket.close(); }
    for (const peer of this.peers.values()) { peer.exchange.close(); peer.link.close(); }
    this.peers.clear();
    for (const id of this.pending.keys()) this.reject(id);
    this.keys?.secret.fill(0); this.keys = undefined; this.quota = new RelayQuota();
  }
  stop() { this.active = false; this.reset(); }
}
