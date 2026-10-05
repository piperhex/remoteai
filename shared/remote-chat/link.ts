import { SessionCipher } from './cipher';
import { Assembler } from './framing';
import { SendQueue } from './sendQueue';
import type { TransferProgress } from './uploadProgress';
import {
  DIRECT_TIMEOUT_MS, RELAY_START_GRACE_MS, MAX_BUFFER_BYTES, type Channel, type ConnectionMode,
  type Peer, type RpcMessage, type Signal,
} from './protocol';

import type { LinkOptions } from './linkOptions';
import { HotLink } from './hotLink';
import { CONNECTION_ERRORS } from './connectionErrors';
import { ConnectionEndpointMonitor } from './connectionEndpoints';

/** One logical encrypted connection across ICE direct transport and the admin fallback relay. */
class LegacyChatLink {
  private peer?: Peer;
  private channel?: Channel;
  private cipher?: SessionCipher;
  private readonly assembler = new Assembler();
  private mode: ConnectionMode = 'connecting';
  private relay = false;
  private quotaBlocked = false;
  private closed = false;
  private readonly outgoing = new SendQueue({ capacity: () => this.waitForCapacity(),
    mode: () => this.mode,
    send: (part, delivered) => {
      if (!this.cipher) throw new Error('正在连接电脑。');
      const payload = this.cipher.encrypt(part);
      if (this.relay && !this.quotaBlocked) {
        if (!this.signal({ type: 'relay', payload })) throw new Error(CONNECTION_ERRORS.network);
      } else this.channel!.send(payload);
      delivered?.();
    } });
  private readonly startedAt = Date.now();
  private readonly fallbackTimer: ReturnType<typeof setTimeout>;

  constructor(private readonly options: LinkOptions) {
    if (options.publicKey) this.setKey(options.publicKey);
    this.fallbackTimer = setTimeout(() => this.fallback(), DIRECT_TIMEOUT_MS + RELAY_START_GRACE_MS);
    try {
      this.peer = options.createPeer({
        iceServers: options.iceServers,
        signal: (payload) => this.signal({ type: 'signal', payload }),
        channel: (channel) => this.attach(channel),
        disconnected: () => this.fallback(),
      });
    } catch { /* Platforms without ICE support still attempt the timed fallback path. */ }
  }

  async offer() {
    try { await this.peer?.offer(); } catch { this.fallback(); }
  }

  get connectionMode() { return this.mode; }
  get directEndpoints() {
    return !this.closed && this.mode === 'direct' ? this.channel?.connectionEndpoints : undefined;
  }

  private signal(message: object) {
    if (this.closed) return false;
    try {
      this.options.signal({ ...message, sessionId: this.options.sessionId });
      return true;
    } catch {
      // ICE/channel callbacks can race the socket close event; v1 must reconnect the whole session.
      this.options.error(CONNECTION_ERRORS.network);
      this.close();
      return false;
    }
  }

  private setKey(publicKey: string) {
    if (this.cipher) throw new Error('Session key cannot change');
    this.cipher = new SessionCipher({ ...this.options, publicKey });
    this.ready();
  }

  async acceptSignal(signal: Signal) {
    if (this.closed) return;
    if (signal.kind === 'key') { this.setKey(signal.key); return; }
    try { await this.peer?.accept(signal); } catch { this.fallback(); }
  }

  private attach(channel: Channel) {
    if (this.closed || this.channel) { channel.close(); return; }
    this.channel = channel;
    channel.onOpen(() => this.ready());
    channel.onClose(() => this.fallback());
    channel.onMessage((payload) => this.receive(payload));
    this.ready();
  }

  private ready() {
    if (this.closed || !this.cipher) return;
    if (this.relay) this.changeMode(this.quotaBlocked ? 'connecting' : 'relay');
    else if (this.channel?.readyState === 'open') {
      clearTimeout(this.fallbackTimer);
      this.changeMode('direct');
    }
  }

  private changeMode(mode: ConnectionMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.options.mode(mode);
  }

  fallback() {
    if (this.closed || this.relay) return;
    if (this.mode === 'direct') {
      this.changeMode('connecting');
      this.signal({ type: 'relay-request', reason: 'disconnected' });
    } else if (Date.now() - this.startedAt >= DIRECT_TIMEOUT_MS + RELAY_START_GRACE_MS
      && this.channel?.readyState !== 'open') {
      // Early ICE failures keep the initial timer so both endpoints give direct discovery its full budget.
      this.signal({ type: 'relay-request', reason: 'timeout' });
    }
  }

  enableRelay() {
    if (this.closed) return;
    this.relay = true;
    clearTimeout(this.fallbackTimer);
    this.peer?.close();
    this.peer = undefined;
    this.ready();
  }

  setRelayQuotaBlocked(blocked: boolean) {
    this.quotaBlocked = blocked;
    if (this.relay) this.changeMode(blocked ? 'connecting' : 'relay');
  }

  receive(payload: string) {
    if (this.closed || !this.cipher) return;
    try {
      const text = this.cipher.decrypt(payload);
      if (text === null) return;
      const message = this.assembler.accept(text, this.mode);
      if (message) this.options.message(message);
    } catch {
      this.options.error('连接校验失败，请重新连接电脑。');
      this.close();
    }
  }

  send(message: RpcMessage, progress?: TransferProgress): Promise<void> {
    return this.outgoing.send(message, progress);
  }

  private async waitForCapacity() {
    const started = Date.now();
    while (!this.closed) {
      const ready = (this.mode === 'relay' && !this.quotaBlocked)
        || (this.mode === 'direct' && this.channel?.readyState === 'open');
      const buffered = this.relay ? this.options.relayBuffered() : (this.channel?.bufferedAmount ?? 0);
      if (ready && buffered < MAX_BUFFER_BYTES) return;
      if (Date.now() - started > 15_000) throw new Error('连接暂时中断，请重新连接。');
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('电脑已断开连接。');
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.outgoing.close();
    clearTimeout(this.fallbackTimer);
    this.peer?.close();
    this.channel?.close();
    this.cipher?.destroy();
    this.assembler.clear();
    this.changeMode('offline');
  }
}

/** Transport v2 is used only when the coordinator and both endpoints advertise support. */
export class ChatLink {
  private readonly implementation: LegacyChatLink | HotLink;
  private readonly endpoints?: ConnectionEndpointMonitor;
  constructor(options: LinkOptions) {
    this.implementation = options.transportVersion === 2 ? new HotLink(options) : new LegacyChatLink(options);
    if (options.directEndpoints) {
      this.endpoints = new ConnectionEndpointMonitor(
        () => this.implementation.directEndpoints, options.directEndpoints);
    }
  }
  get resumable() { return this.implementation instanceof HotLink && this.implementation.resumable; }
  get bulk() { return this.implementation instanceof HotLink ? this.implementation.bulk : undefined; }
  createBulkCipher(context: Parameters<SessionCipher['createBulkCipher']>[0]) {
    if (!(this.implementation instanceof HotLink)) throw new Error('Bulk unavailable');
    return this.implementation.createBulkCipher(context);
  }
  openNativeMedia(viewId: string) {
    return this.implementation instanceof HotLink ? this.implementation.openNativeMedia(viewId)
      : Promise.resolve(undefined);
  }
  reportDiagnostic: import('./diagnostics').ConnectionDiagnostic = (event, fields) => {
    if (this.implementation instanceof HotLink) this.implementation.reportDiagnostic(event, fields);
  };
  renew(expiresAt: number) {
    if (this.implementation instanceof HotLink) this.implementation.renew(expiresAt);
  }
  get connectionMode() { return this.implementation.connectionMode; }
  offer() { return this.implementation.offer(); }
  acceptSignal(signal: Signal) { return this.implementation.acceptSignal(signal); }
  enableRelay() { this.implementation.enableRelay(); }
  setRelayQuotaBlocked(blocked: boolean) { this.implementation.setRelayQuotaBlocked(blocked); }
  fallback() { this.implementation.fallback(); }
  receive(payload: string) { this.implementation.receive(payload); }
  send(message: RpcMessage, progress?: TransferProgress) { return this.implementation.send(message, progress); }
  setRelayAvailable(available: boolean) {
    if (this.implementation instanceof HotLink) this.implementation.setRelayAvailable(available);
    else if (!available) this.implementation.close();
  }
  close() { this.endpoints?.close(); this.implementation.close(); }
}
