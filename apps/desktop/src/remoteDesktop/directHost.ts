import type { IceServer } from '../../../../shared/remote-chat/protocol';
import type { DesktopSignal, DesktopSignalReply } from '../../../../shared/remote-desktop/protocol';
import { directIceServers } from '../../../../shared/remote-desktop/directUpgrade';
import { DesktopStatsSampler } from '../../../../shared/remote-desktop/stats';
import { addIceCandidate } from '../../../../shared/remote-chat/iceCandidate';
import { nativeMediaEndpoint } from '../../../../shared/remote-desktop/nativeMedia';
import { configureDesktopSender } from './videoSender';

const PROBE_LIFETIME = 35_000;
const MIN_RETRY = 5000;
const MAX_CANDIDATES = 128;
export interface BrowserDesktopPeer {
  pc: RTCPeerConnection; channel: RTCDataChannel; clipboard: RTCDataChannel; sender?: RTCRtpSender;
}
interface Options {
  iceServers: IceServer[];
  stream: () => MediaStream | undefined;
  bind: (peer: BrowserDesktopPeer) => void;
  activate: (peer: BrowserDesktopPeer) => BrowserDesktopPeer;
  retain?: (peer: BrowserDesktopPeer) => void;
}
interface Probe extends BrowserDesktopPeer { candidates: RTCIceCandidateInit[]; received: number }

/** Browser capture shares its existing media tracks with one temporary direct-only peer. */
export class BrowserDesktopDirectHost {
  private probe?: Probe;
  private retiring?: BrowserDesktopPeer;
  private generation = 0;
  private committed = false;
  private started = -Infinity;
  private expiry?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private busy = false;
  constructor(private readonly options: Options) {}

  async signal(signal: DesktopSignal): Promise<DesktopSignalReply> {
    const upgrade = signal.directUpgrade;
    if (this.stopped || this.busy || !upgrade || !Number.isInteger(upgrade.generation)
      || upgrade.generation < 1 || upgrade.generation > 1_000_000) throw new Error('桌面连接信息无效。');
    this.busy = true;
    try {
      if (upgrade.action === 'start') return await this.start(upgrade.generation);
      if (upgrade.generation !== this.generation) throw new Error('桌面连接信息无效。');
      if (upgrade.action === 'cancel') { this.cancel(); return { candidates: [] }; }
      if (upgrade.action === 'commit') return await this.commit();
      if (upgrade.action !== 'signal' || !this.probe) throw new Error('桌面连接信息无效。');
      return await this.exchange(this.probe, signal);
    } finally { this.busy = false; }
  }

  private async start(generation: number): Promise<DesktopSignalReply> {
    const stream = this.options.stream();
    if (!stream || generation <= this.generation || this.probe || this.retiring
      || Date.now() - this.started < MIN_RETRY) throw new Error('桌面连接信息无效。');
    this.generation = generation; this.started = Date.now(); this.committed = false;
    const pc = new RTCPeerConnection({ iceServers: directIceServers(this.options.iceServers) });
    const probe: Probe = { pc, candidates: [], received: 0,
      channel: pc.createDataChannel('remote-desktop-controls', { ordered: true }),
      clipboard: pc.createDataChannel('remote-desktop-clipboard', { ordered: true }) };
    this.probe = probe;
    for (const track of stream.getTracks()) {
      const sender = pc.addTrack(track, stream);
      if (track.kind === 'video') probe.sender = sender;
    }
    pc.addEventListener('icecandidate', event => {
      if (this.probe === probe && event.candidate && probe.candidates.length < MAX_CANDIDATES) {
        probe.candidates.push(event.candidate.toJSON());
      }
    });
    this.options.bind(probe);
    this.expiry = setTimeout(() => this.cancel(), PROBE_LIFETIME);
    try {
      const offer = await pc.createOffer();
      if (this.stopped) throw new Error('桌面连接已结束。');
      await pc.setLocalDescription(offer);
      await configureDesktopSender(probe.sender);
      if (this.stopped || this.probe !== probe) throw new Error('桌面连接已结束。');
      return { sdp: offer.sdp, generation, candidates: [] };
    } catch (error) { this.cancel(); throw error; }
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

  private async commit(): Promise<DesktopSignalReply> {
    if (!this.committed) {
      const probe = this.probe;
      if (!probe) return { candidates: [], generation: this.generation, committed: false };
      const stats = new DesktopStatsSampler(nativeMediaEndpoint(this.options.iceServers)).sample(await probe.pc.getStats());
      if (this.stopped || probe !== this.probe || stats.connection !== 'direct'
        || probe.pc.connectionState !== 'connected' || probe.channel.readyState !== 'open') {
        return { candidates: [], generation: this.generation, committed: false };
      }
      clearTimeout(this.expiry); this.expiry = undefined;
      this.probe = undefined; this.committed = true;
      this.retiring = this.options.activate(probe);
    }
    return { candidates: [], generation: this.generation, committed: true };
  }

  isRetiring(pc: RTCPeerConnection) { return this.retiring?.pc === pc; }
  fallback() { if (!this.probe) this.committed = false; }
  retire() {
    const peer = this.retiring; this.retiring = undefined;
    if (!peer) return;
    if (this.options.retain && !this.stopped) this.options.retain(peer);
    else peer.pc.close();
  }
  private cancel() {
    if (this.committed) return;
    clearTimeout(this.expiry); this.expiry = undefined;
    this.probe?.pc.close(); this.probe = undefined;
  }
  close() { this.stopped = true; this.cancel(); this.retire(); }
}
