import { SessionCipher } from './cipher';
import { BulkTransport } from './bulkTransport';
import { deliveryFrame, type DeliveryData } from './delivery';
import { fitsRelayChunkLimit } from './framing';
import { LinkDelivery } from './linkDelivery';
import type { TransferProgress } from './uploadProgress';
import { HotPeer } from './hotPeer';
import { DirectPackets, directPackets } from './directPackets';
import { connectionDiagnostic } from './diagnostics';
import { getChatPolicy } from './policy';
import type { LinkOptions } from './linkOptions';
import type { ConnectionEndpoints } from './connectionEndpoints';
import { PeerEndpointObservation } from './peerEndpointObservation';
import { ChannelBackpressureError } from './channelBackpressure';
import { MAX_BUFFER_BYTES, type Channel, type ConnectionMode, type RpcMessage, type Signal } from './protocol';

type Path = 'direct' | 'relay';
const TICK_MS = 250;
const PROBE_MS = 1000;
const DIRECT_TIMEOUT_SECONDS = 3;
const MILLISECONDS_PER_SECOND = 1000;
const MAX_PENDING_PROBES = 128;
const DIRECT_STABLE_MS = 3000;
const OUTAGE_TIMEOUT_MS = 60_000;
const TIMER_STALL_MS = 5000;

/** Both paths stay open. Authenticated acknowledgements cover every fragment, including events. */
export class HotLink {
  readonly bulk: BulkTransport;
  private readonly diagnostic;
  private readonly peer: HotPeer;
  private readonly delivery: LinkDelivery;
  private readonly timer: ReturnType<typeof setInterval>;
  private cipher?: SessionCipher;
  private channel?: Channel;
  private readonly endpointObservation = new PeerEndpointObservation();
  private readonly directPackets = new DirectPackets({
    send: (payload) => {
      if (this.channel?.readyState !== 'open') throw new Error('Direct path unavailable');
      this.channel.send(payload);
    },
    failed: error => { if (!(error instanceof ChannelBackpressureError)) this.fallback(); },
  });
  private relay = true;
  private relayTimedOut = false;
  private quotaBlocked = false;
  private closed = false;
  private mode: ConnectionMode = 'connecting';
  private selected?: Path;
  private directSince = 0;
  private outageSince = Date.now();
  private lastTick = Date.now();
  private expiresAt = 0;
  private established = false;
  private lastProbe = 0;
  private probeId = 0;
  private relaySince = Date.now();
  private readonly lastPong = { direct: 0, relay: 0 };
  private readonly probes = new Map<number, { path: Path; at: number;
    route?: ReturnType<PeerEndpointObservation['capture']> }>();

  constructor(private readonly options: LinkOptions) {
    this.bulk = new BulkTransport(options.bulkRelay);
    this.diagnostic = connectionDiagnostic(options.sessionId, options.desktop, (event, fields) => {
      if (!this.closed && this.relay && options.diagnosticsEnabled?.() && options.relayBuffered() < MAX_BUFFER_BYTES) {
        options.signal({ type: 'diagnostic', sessionId: options.sessionId, payload: { event, ...fields } });
      }
    });
    this.delivery = new LinkDelivery({
      send: (frame, retry) => this.sendData(frame, retry),
      message: options.message, mode: () => this.mode,
    });
    this.delivery.setAvailable(false);
    if (options.publicKey) this.setKey(options.publicKey);
    this.peer = new HotPeer({ ...options,
      bulkChannel: options.binaryBulk ? (channel, source) => this.bulk.attach(channel, source) : undefined,
      diagnostic: this.diagnostic,
      signal: (payload) => this.signal({ type: 'signal', payload }),
      channel: (channel) => this.attach(channel), disconnected: () => this.fallback(),
    });
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  get resumable() { return !this.closed && Boolean(this.cipher); }
  reportDiagnostic: import('./diagnostics').ConnectionDiagnostic = (event, fields) => this.diagnostic(event, fields);
  get connectionMode() { return this.mode; }
  createBulkCipher(context: Parameters<SessionCipher['createBulkCipher']>[0]) {
    if (!this.cipher) throw new Error('Session unavailable');
    return this.cipher.createBulkCipher(context);
  }
  get directEndpoints() {
    return !this.closed && this.mode === 'direct' ? this.endpointObservation.read(this.channel) : undefined;
  }
  openNativeMedia(viewId: string) { return this.peer.openNativeMedia(viewId); }
  offer() { return this.peer.offer(); }
  renew(expiresAt: number) { this.expiresAt = expiresAt; this.peer.renew(expiresAt); }

  private setKey(key: string) {
    if (this.cipher) throw new Error('Session key cannot change');
    this.cipher = new SessionCipher({ ...this.options, publicKey: key });
  }

  async acceptSignal(signal: Signal) {
    if (this.closed) return;
    if (signal.kind === 'key') { this.setKey(signal.key); return; }
    await this.peer.accept(signal);
  }

  private signal(message: object): boolean {
    if (this.closed || !this.relay) return false;
    try { this.options.signal({ ...message, sessionId: this.options.sessionId }); return true; }
    catch { this.setRelayAvailable(false); return false; }
  }

  private attach(channel: Channel) {
    if (this.closed) { channel.close(); return; }
    const previous = this.channel;
    this.endpointObservation.clear();
    this.directPackets.clear();
    this.channel = channel;
    previous?.close();
    this.lastPong.direct = 0;
    this.directSince = 0;
    channel.onOpen(() => { if (this.channel === channel) this.probe('direct'); });
    channel.onClose(() => { if (this.channel === channel) this.fallback(); });
    channel.onMessage((payload, endpoints) => {
      if (this.channel === channel) this.receive(payload, 'direct', endpoints ?? channel.connectionEndpoints);
    });
    if (channel.readyState === 'open') this.probe('direct');
  }

  private transmit(path: Path, frame: object): boolean {
    if (!this.cipher || this.closed) return false;
    const buffered = path === 'relay' ? this.options.relayBuffered()
      : (this.channel?.bufferedAmount ?? MAX_BUFFER_BYTES) + this.directPackets.bufferedAmount;
    if (buffered === undefined || buffered >= MAX_BUFFER_BYTES) return false;
    if (path === 'direct' && this.channel?.readyState !== 'open') return false;
    if (path === 'relay' && (!this.relay || this.quotaBlocked)) return false;
    const payload = this.cipher.encrypt(JSON.stringify(frame));
    try {
      if (path === 'relay') return this.signal({ type: 'relay', payload });
      this.directPackets.send(payload, 'kind' in frame && frame.kind === 'data');
      return true;
    } catch (error) {
      if (!(path === 'direct' && error instanceof ChannelBackpressureError)) this.lastPong[path] = 0;
      return false;
    }
  }

  private sendData(frame: DeliveryData, retry: boolean): boolean {
    if (!this.selected) return false;
    const alternative = this.selected === 'direct' ? 'relay' : 'direct';
    const sent = this.transmit(this.selected, frame);
    // A successful heartbeat does not prove data or acknowledgements are getting through.
    // Keep retrying the selected path and let the other healthy path recover the same sequence.
    if ((retry || !sent) && this.healthy(alternative)
      && (alternative !== 'relay' || fitsRelayChunkLimit(frame.text))) {
      return this.transmit(alternative, frame) || sent;
    }
    return sent;
  }

  private probe(path: Path) {
    const id = ++this.probeId;
    this.probes.set(id, { path, at: Date.now(),
      route: path === 'direct' ? this.endpointObservation.capture(this.channel) : undefined });
    // A very large configured timeout must not retain unanswered probes indefinitely.
    if (this.probes.size > MAX_PENDING_PROBES) this.probes.delete(this.probes.keys().next().value!);
    const frame = { kind: 'ping', id, packetBatching: true, parallelResponses: true };
    if (!this.transmit(path, frame)) this.probes.delete(id);
  }

  receive(payload: string, path: Path = 'relay', endpoints?: ConnectionEndpoints) {
    if (this.closed || !this.cipher) return;
    try {
      const packets = path === 'direct' ? directPackets(payload) : [payload];
      for (const packet of packets) this.receivePacket(packet, path, endpoints);
    } catch { this.fail('连接校验失败，请重新连接电脑。'); }
  }

  private receivePacket(payload: string, path: Path, endpoints?: ConnectionEndpoints) {
    if (this.closed || !this.cipher) return;
    const text = this.cipher.decrypt(payload);
    if (text === null) return;
    const frame = deliveryFrame(text);
    if (frame.kind === 'close') { this.close(false); return; }
    if (frame.kind === 'ping') {
      if (!Number.isSafeInteger(frame.id)) throw new Error('Invalid probe');
      if (frame.parallelResponses === true) this.delivery.enableResponses();
      if (path === 'direct' && frame.packetBatching === true) this.directPackets.enable();
      this.transmit(path, { kind: 'pong', id: frame.id, packetBatching: true, parallelResponses: true,
        observedEndpoint: path === 'direct' ? endpoints?.remote : undefined });
    } else if (frame.kind === 'pong') {
      if (frame.parallelResponses === true) this.delivery.enableResponses();
      if (path === 'direct' && frame.packetBatching === true) this.directPackets.enable();
      this.pong(frame, path);
    } else {
      this.delivery.accept(frame, (ack) => { this.transmit(path, ack); }, path);
    }
  }

  private pong(frame: Record<string, unknown>, path: Path) {
    const id = Number(frame.id);
    const probe = this.probes.get(id);
    if (!probe || probe.path !== path || this.timedOut(path, probe.at)) return;
    this.probes.delete(id);
    if (path === 'direct') this.endpointObservation.confirm({ channel: this.channel,
      route: probe.route, id, endpoint: frame.observedEndpoint });
    if (path === 'direct' && !this.healthy('direct')) this.directSince = Date.now();
    this.lastPong[path] = Date.now();
    if (path === 'relay') this.relayTimedOut = false;
    this.choose();
  }

  private healthy(path: Path) {
    const open = path === 'relay' ? this.relay && !this.quotaBlocked : this.channel?.readyState === 'open';
    return Boolean(open && this.lastPong[path] && !this.timedOut(path, this.lastPong[path]));
  }

  private timedOut(path: Path, since: number, now = Date.now()) {
    const seconds = path === 'direct' ? DIRECT_TIMEOUT_SECONDS : getChatPolicy().relayHeartbeatTimeoutSeconds;
    return (now - since) / MILLISECONDS_PER_SECOND >= seconds;
  }

  private choose() {
    if (this.closed) return;
    this.resumeDelivery();
    const direct = this.healthy('direct');
    const relay = this.healthy('relay');
    const stable = Date.now() - this.directSince >= DIRECT_STABLE_MS;
    let path: Path | undefined;
    if (direct && (stable || this.selected === 'direct' || !relay)) path = 'direct';
    else if (relay) path = 'relay';
    const changed = path !== this.selected;
    if (changed) this.directPackets.clear();
    if (changed && path !== 'direct') this.endpointObservation.clear();
    this.selected = path;
    this.delivery.setAvailable(Boolean(path) || !this.expiresAt);
    if (path) { this.outageSince = Date.now(); this.established = true; }
    const mode = path ?? 'connecting';
    if (mode !== this.mode) {
      this.diagnostic('mode', { mode, directHealthy: direct, relayHealthy: relay });
      this.mode = mode;
      this.bulk.setMode(mode);
      this.options.mode(mode);
    }
    if (changed && path) this.delivery.flush(true);
  }

  private tick() {
    if (this.closed) return;
    try {
      const now = Date.now();
      if (this.expiresAt && now >= this.expiresAt) { this.close(); return; }
      if (now - this.lastProbe >= PROBE_MS) {
        this.lastProbe = now;
        for (const [id, probe] of this.probes) {
          if (this.timedOut(probe.path, probe.at, now)) this.probes.delete(id);
        }
        this.probe('direct');
        this.probe('relay');
      }
      this.choose();
      this.delivery.flush();
      this.peer.recover(this.healthy('direct'), this.relay);
      // Relay probes traverse the coordinator and the remote UI; brief stalls must not reset that socket.
      const relaySilence = now - Math.max(this.relaySince, this.lastPong.relay);
      if (this.relay && !this.quotaBlocked && !this.relayTimedOut
        && this.timedOut('relay', Math.max(this.relaySince, this.lastPong.relay), now)) {
        this.relayTimedOut = true;
        this.diagnostic('relay-timeout', { elapsedMs: relaySilence });
        // A silent viewer does not prove the host's shared coordinator socket is broken.
        // Keep probing it; native WebSocket heartbeats recover an actual host socket outage.
        if (!this.options.desktop) {
          this.setRelayAvailable(false);
          this.options.reconnectRelay?.();
        }
      }
      // Keep established sessions through mobile background outages, bounded by the authenticated lease.
      if (!this.selected && !(this.established && this.expiresAt > now)
        && now - this.outageSince > OUTAGE_TIMEOUT_MS) this.fail('连接已中断，请重新连接电脑。');
    } catch { this.fail('连接暂时中断，请重新连接电脑。'); }
  }

  private resumeDelivery() {
    const now = Date.now();
    // Socket callbacks can resume before timers after a suspended JS runtime.
    if (this.expiresAt && now - this.lastTick > TIMER_STALL_MS) {
      this.delivery.setAvailable(false, this.lastTick);
    }
    this.lastTick = now;
  }

  fallback() {
    this.endpointObservation.clear();
    this.lastPong.direct = 0; this.directSince = 0; this.choose();
  }
  enableRelay() { this.setRelayAvailable(true); }

  setRelayQuotaBlocked(blocked: boolean) {
    if (this.closed || this.quotaBlocked === blocked) return;
    this.quotaBlocked = blocked;
    this.lastPong.relay = 0;
    this.relaySince = Date.now();
    if (!blocked) this.probe('relay');
    this.choose();
  }

  setRelayAvailable(available: boolean) {
    if (this.closed) return;
    this.relay = available;
    this.relayTimedOut = false;
    this.lastPong.relay = 0;
    this.relaySince = Date.now();
    if (available) this.probe('relay');
    this.choose();
  }

  async send(message: RpcMessage, progress?: TransferProgress): Promise<void> {
    this.choose();
    return this.delivery.send(message, progress);
  }

  private fail(message: string) {
    this.diagnostic('link-failed');
    this.options.error(message);
    this.close();
  }

  close(notify = true) {
    if (this.closed) return;
    if (notify) { this.transmit('direct', { kind: 'close' }); this.transmit('relay', { kind: 'close' }); }
    this.closed = true;
    this.bulk.close();
    this.endpointObservation.clear();
    this.directPackets.clear();
    clearInterval(this.timer);
    this.peer.close();
    this.channel?.close();
    this.cipher?.destroy();
    this.delivery.clear();
    this.probes.clear();
    this.options.mode('offline');
  }
}
