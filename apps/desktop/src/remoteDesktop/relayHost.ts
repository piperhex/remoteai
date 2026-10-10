import type { IceServer } from '../../../../shared/remote-chat/protocol';
import type { DesktopSignal, DesktopSignalReply } from '../../../../shared/remote-desktop/protocol';
import { addIceCandidate } from '../../../../shared/remote-chat/iceCandidate';
import { relayIceServers, STANDBY_ACTIVE, STANDBY_ACTIVATE, STANDBY_PING, STANDBY_PONG }
  from '../../../../shared/remote-desktop/standbyProtocol';
import type { BrowserDesktopPeer } from './directHost';
import { configureDesktopSender } from './videoSender';

const PROBE_LIFETIME_MS = 35_000;
const MIN_RETRY_MS = 5000;
const MAX_CANDIDATES = 128;
interface Options {
  iceServers: IceServer[];
  stream: () => MediaStream | undefined;
  current: () => RTCPeerConnection;
  bind: (peer: BrowserDesktopPeer) => void;
  activate: (peer: BrowserDesktopPeer) => BrowserDesktopPeer;
}
interface Probe extends BrowserDesktopPeer { candidates: RTCIceCandidateInit[]; received: number }

/** Retained TURN connections carry only control heartbeats until the viewer needs their media. */
export class BrowserDesktopRelayHost {
  private peer?: BrowserDesktopPeer;
  private pending?: Probe;
  private generation = 0;
  private committed = false;
  private started = -Infinity;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private busy = false;
  private switching?: Promise<boolean>;
  private readonly tracks = new WeakMap<RTCRtpSender, MediaStreamTrack>();
  private mediaWork = Promise.resolve();
  constructor(private readonly options: Options) {}

  retain(peer: BrowserDesktopPeer) {
    this.cancel(); this.committed = false;
    this.keep(peer);
  }

  private keep(peer: BrowserDesktopPeer) {
    if (this.stopped) { peer.pc.close(); return; }
    const previous = this.peer;
    this.peer = peer;
    if (previous && previous.pc !== peer.pc) previous.pc.close();
    void this.media(peer, false).catch(() => { if (this.peer === peer) this.peer = undefined; peer.pc.close(); });
  }

  private media(peer: BrowserDesktopPeer, enabled: boolean) {
    this.mediaWork = this.mediaWork.catch(() => undefined).then(async () => {
      for (const sender of peer.pc.getSenders()) {
        if (sender.track) this.tracks.set(sender, sender.track);
        await sender.replaceTrack(enabled ? this.tracks.get(sender) ?? null : null);
      }
    });
    return this.mediaWork;
  }

  receive(peer: BrowserDesktopPeer, data: string): boolean | 'ignored' {
    if (data !== STANDBY_PING && data !== STANDBY_ACTIVATE) return false;
    // A faster retiring relay may deliver its first heartbeat before the direct peer is acknowledged.
    if (this.stopped || this.peer?.pc !== peer.pc) return 'ignored';
    if (data === STANDBY_PING) {
      try { peer.channel.send(STANDBY_PONG); } catch { /* The viewer rebuilds an unresponsive backup. */ }
      return true;
    }
    void this.fallback(); return true;
  }

  fallback(failed?: RTCPeerConnection): Promise<boolean> {
    const peer = this.peer;
    if (this.stopped || !peer || peer.pc === failed || peer.pc.connectionState !== 'connected'
      || peer.channel.readyState !== 'open') return Promise.resolve(false);
    this.switching ??= this.restore(peer).finally(() => { this.switching = undefined; });
    return this.switching;
  }

  private async restore(peer: BrowserDesktopPeer) {
    try {
      await this.media(peer, true);
      if (this.stopped || this.peer !== peer) return false;
      if (this.options.current() !== peer.pc) {
        const previous = this.options.activate(peer);
        previous.pc.close();
      }
      peer.channel.send(STANDBY_ACTIVE); return true;
    } catch { return false; }
  }

  async signal(signal: DesktopSignal): Promise<DesktopSignalReply> {
    const request = signal.relayStandby;
    if (this.stopped || this.busy || !request || !Number.isInteger(request.generation)
      || request.generation < 1 || request.generation > 1_000_000) throw new Error('桌面连接信息无效。');
    this.busy = true;
    try {
      if (request.action === 'start') return await this.start(request.generation);
      if (request.generation !== this.generation) throw new Error('桌面连接信息无效。');
      if (request.action === 'cancel') { this.cancel(); return { candidates: [] }; }
      if (request.action === 'commit') return this.commit();
      if (request.action !== 'signal' || !this.pending) throw new Error('桌面连接信息无效。');
      return await this.exchange(this.pending, signal);
    } finally { this.busy = false; }
  }

  private async start(generation: number): Promise<DesktopSignalReply> {
    const stream = this.options.stream(), iceServers = relayIceServers(this.options.iceServers);
    if (!stream || !iceServers.length || generation <= this.generation || this.pending
      || Date.now() - this.started < MIN_RETRY_MS) throw new Error('桌面连接信息无效。');
    this.generation = generation; this.started = Date.now(); this.committed = false;
    const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'relay' });
    const probe: Probe = { pc, candidates: [], received: 0,
      channel: pc.createDataChannel('remote-desktop-controls', { ordered: true }),
      clipboard: pc.createDataChannel('remote-desktop-clipboard', { ordered: true }) };
    this.pending = probe;
    for (const track of stream.getTracks()) {
      const sender = pc.addTrack(track, stream);
      if (track.kind === 'video') probe.sender = sender;
    }
    pc.addEventListener('icecandidate', event => {
      if (this.pending === probe && event.candidate && probe.candidates.length < MAX_CANDIDATES) {
        probe.candidates.push(event.candidate.toJSON());
      }
    });
    this.options.bind(probe); this.timer = setTimeout(() => this.cancel(), PROBE_LIFETIME_MS);
    try {
      const offer = await pc.createOffer();
      if (this.stopped || this.pending !== probe) throw new Error('桌面连接已结束。');
      await pc.setLocalDescription(offer);
      await configureDesktopSender(probe.sender);
      await this.media(probe, false);
      if (this.stopped || this.pending !== probe) throw new Error('桌面连接已结束。');
      return { sdp: offer.sdp, generation, candidates: [] };
    } catch (error) { if (this.pending === probe) this.cancel(); throw error; }
  }

  private async exchange(probe: Probe, signal: DesktopSignal): Promise<DesktopSignalReply> {
    if (!Array.isArray(signal.candidates) || probe.received + signal.candidates.length > MAX_CANDIDATES) {
      throw new Error('桌面连接信息无效。');
    }
    if (signal.answer !== undefined) {
      if (typeof signal.answer !== 'string' || signal.answer.length > 64_000 || probe.pc.remoteDescription) {
        throw new Error('桌面连接信息无效。');
      }
      await probe.pc.setRemoteDescription({ type: 'answer', sdp: signal.answer });
    }
    for (const candidate of signal.candidates) {
      if (!candidate || typeof candidate.candidate !== 'string' || candidate.candidate.length > 4096) {
        throw new Error('桌面连接信息无效。');
      }
      probe.received++; await addIceCandidate(probe.pc, candidate);
    }
    return { candidates: probe.candidates.splice(0) };
  }

  private commit(): DesktopSignalReply {
    const probe = this.pending;
    if (!this.committed && probe?.pc.connectionState === 'connected' && probe.channel.readyState === 'open') {
      clearTimeout(this.timer); this.pending = undefined; this.committed = true;
      this.keep(probe);
    }
    return { candidates: [], generation: this.generation, committed: this.committed };
  }
  private cancel() {
    clearTimeout(this.timer); this.pending?.pc.close(); this.pending = undefined;
  }
  close() { this.stopped = true; this.cancel(); this.peer?.pc.close(); this.peer = undefined; }
}
