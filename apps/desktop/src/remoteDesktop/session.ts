import type { IceServer } from '../../../../shared/remote-chat/protocol';
import { DesktopAdaptation, type NetworkSample } from '../../../../shared/remote-desktop/adaptation';
import type { DesktopSettings, DesktopSignal, DesktopSignalReply } from '../../../../shared/remote-desktop/protocol';
import { DesktopCapture } from './capture';
import { DesktopControls } from './controls';
import { MAX_CONTROL_MESSAGE_BYTES } from '../../../../shared/remote-desktop/clipboard';
import { RtcObserver } from '../../../../shared/remote-chat/rtcObserver';
import { addIceCandidate } from '../../../../shared/remote-chat/iceCandidate';
import type { ConnectionDiagnostic } from '../../../../shared/remote-chat/diagnostics';

import { BrowserDesktopDirectHost, type BrowserDesktopPeer } from './directHost';
import { BrowserDesktopRelayHost } from './relayHost';
import { configureDesktopSender } from './videoSender';
import { DesktopNetworkSampler } from './networkSample';

const HEARTBEAT_TIMEOUT = 12_000;
const SETUP_TIMEOUT = 30_000;
const STATS_INTERVAL = 2000;
const MAX_CANDIDATES = 128;

export class DesktopHostSession {
  private pc: RTCPeerConnection;
  private readonly initialPc: RTCPeerConnection;
  private readonly capture = new DesktopCapture();
  private readonly adaptation = new DesktopAdaptation();
  private readonly network = new DesktopNetworkSampler();
  private readonly controls = new DesktopControls(this.capture, () => this.fail(), message => {
    if (this.channel.readyState === 'open') this.channel.send(JSON.stringify(message));
  });
  private channel: RTCDataChannel;
  private clipboardChannel: RTCDataChannel;
  private readonly clipboardControls = new DesktopControls(this.capture, () => this.clipboardChannel.close(), message => {
    if (this.clipboardChannel.readyState === 'open') this.clipboardChannel.send(JSON.stringify(message));
  });
  private sender?: RTCRtpSender;
  private media?: MediaStream;
  private readonly direct: BrowserDesktopDirectHost;
  private readonly standby?: BrowserDesktopRelayHost;
  private candidates: RTCIceCandidateInit[] = [];
  private receivedCandidates = 0;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private expires: ReturnType<typeof setTimeout>;
  private lastStats = 0;
  private frames = 0;
  private settings: DesktopSettings;
  private observer?: RtcObserver;

  constructor(settings: DesktopSettings, private readonly iceServers: IceServer[], private expiresAt?: number,
    private readonly diagnostic?: ConnectionDiagnostic) {
    if (settings.relayStandby) this.standby = new BrowserDesktopRelayHost({ iceServers, stream: () => this.media,
      current: () => this.pc, bind: peer => this.bind(peer), activate: peer => {
        this.direct.fallback(); return this.activate(peer);
      } });
    this.direct = new BrowserDesktopDirectHost({ iceServers, stream: () => this.media,
      bind: peer => this.bind(peer), activate: peer => this.activate(peer),
      retain: this.standby ? peer => this.standby!.retain(peer) : undefined });
    this.settings = settings;
    this.adaptation.update(settings);
    this.pc = new RTCPeerConnection({ iceServers });
    this.initialPc = this.pc;
    if (diagnostic) this.observer = new RtcObserver(this.pc, diagnostic);
    this.channel = this.pc.createDataChannel('remote-desktop-controls', { ordered: true });
    this.clipboardChannel = settings.clipboardChannel
      ? this.pc.createDataChannel('remote-desktop-clipboard', { ordered: true }) : this.channel;
    this.expires = setTimeout(() => this.close(), SETUP_TIMEOUT);
    this.bind();
  }

  private bind(peer: BrowserDesktopPeer = { pc: this.pc, channel: this.channel, clipboard: this.clipboardChannel }) {
    const { pc, channel, clipboard: clipboardChannel } = peer;
    if (clipboardChannel !== channel) clipboardChannel.addEventListener('message', ({ data }) => {
      if (this.stopped || (this.pc !== pc && !this.direct.isRetiring(pc))
        || typeof data !== 'string' || data.length > MAX_CONTROL_MESSAGE_BYTES) return;
      try {
        if ((JSON.parse(data) as { kind?: string }).kind !== 'clipboard') return;
        this.clipboardControls.receive(data);
      } catch { clipboardChannel.close(); }
    });
    pc.addEventListener('icecandidate', ({ candidate }) => {
      if (this.pc === pc && candidate && this.candidates.length < MAX_CANDIDATES) {
        this.candidates.push(candidate.toJSON());
      }
    });
    pc.addEventListener('connectionstatechange', () => {
      if (this.pc === pc && ['failed', 'closed'].includes(pc.connectionState)) void this.recover(pc);
    });
    channel.addEventListener('close', () => { if (this.pc === pc) void this.recover(pc); });
    channel.addEventListener('message', ({ data }) => {
      if (this.stopped) return;
      const standby = typeof data === 'string' && this.standby?.receive(peer, data);
      if (standby === 'ignored') return;
      if (standby) {
        clearTimeout(this.expires); this.expires = setTimeout(() => this.close(), HEARTBEAT_TIMEOUT); return;
      }
      if (this.stopped || (this.pc !== pc && !this.direct.isRetiring(pc))) return;
      if (typeof data !== 'string' || data.length > MAX_CONTROL_MESSAGE_BYTES) {
        this.fail(); return;
      }
      if (data === '{"kind":"ping"}') {
        if (this.pc === pc) this.direct.retire();
        if (this.standby && this.pc === pc) channel.send('{"kind":"pong"}');
        clearTimeout(this.expires); this.expires = setTimeout(() => this.close(), HEARTBEAT_TIMEOUT); return;
      }
      try { this.controls.receive(data); } catch { this.fail(); }
    });
  }

  async open() {
    const stream = await this.capture.open(this.adaptation.profile().width, this.settings.displayId, this.expiresAt);
    if (this.stopped) throw new Error('桌面连接已结束。');
    this.adaptation.update(this.settings, this.capture.displays);
    this.media = stream;
    this.sender = this.pc.addTrack(stream.getVideoTracks()[0], stream);
    // Android's bundled decoder factory offers native H.264 hardware decoding with native software fallback.
    const codecs = RTCRtpSender.getCapabilities('video')?.codecs;
    const transceiver = this.pc.getTransceivers().find(item => item.sender === this.sender);
    if (codecs && transceiver?.setCodecPreferences) {
      transceiver.setCodecPreferences([...codecs.filter(codec => codec.mimeType === 'video/H264'),
        ...codecs.filter(codec => codec.mimeType !== 'video/H264')]);
    }
    const offer = await this.pc.createOffer();
    if (this.stopped) throw new Error('桌面连接已结束。');
    await this.pc.setLocalDescription(offer);
    await this.applyProfile();
    this.lastStats = performance.now();
    void this.tick();
    return { sdp: offer.sdp ?? '', iceServers: this.iceServers, directUpgrade: true,
      relayStandby: Boolean(this.standby), ...this.capture.displays };
  }

  async signal(signal: DesktopSignal): Promise<DesktopSignalReply> {
    if (this.stopped) throw new Error('桌面连接已结束，请重新连接。');
    if (signal.relayStandby && signal.directUpgrade) throw new Error('桌面连接信息无效。');
    if (signal.relayStandby && this.standby) return this.standby.signal(signal);
    if (signal.directUpgrade) return this.direct.signal(signal);
    if (this.pc !== this.initialPc) return { candidates: [] };
    if (!Array.isArray(signal.candidates) || signal.candidates.length + this.receivedCandidates > MAX_CANDIDATES) {
      throw new Error('桌面连接信息无效。');
    }
    if (signal.answer !== undefined) {
      if (typeof signal.answer !== 'string' || signal.answer.length > 64_000 || this.pc.remoteDescription) {
        throw new Error('桌面连接信息无效。');
      }
      await this.pc.setRemoteDescription({ type: 'answer', sdp: signal.answer });
    }
    for (const candidate of signal.candidates) {
      if (typeof candidate.candidate !== 'string' || candidate.candidate.length > 4096) {
        throw new Error('桌面连接信息无效。');
      }
      this.receivedCandidates += 1;
      this.observer?.candidate(candidate, 'remote');
      await addIceCandidate(this.pc, candidate, this.diagnostic);
    }
    return { candidates: this.candidates.splice(0) };
  }

  private activate(peer: BrowserDesktopPeer): BrowserDesktopPeer {
    const previous = { pc: this.pc, channel: this.channel, clipboard: this.clipboardChannel, sender: this.sender };
    this.pc = peer.pc; this.channel = peer.channel; this.clipboardChannel = peer.clipboard;
    this.sender = peer.sender; this.candidates.length = 0; this.receivedCandidates = 0;
    this.network.reset(); this.adaptation.resetNetwork();
    this.observer?.close();
    if (this.diagnostic) {
      this.observer = new RtcObserver(peer.pc, this.diagnostic); void this.observer.snapshot();
    }
    return previous;
  }

  private async recover(pc: RTCPeerConnection) {
    if (this.stopped || this.pc !== pc) return;
    this.direct.retire();
    if (!await this.standby?.fallback(pc) && this.pc === pc) await this.close();
  }

  update(settings: DesktopSettings) { this.settings = settings; this.adaptation.update(settings); }
  async renew(expiresAt: number) { this.expiresAt = expiresAt; await this.capture.renew(expiresAt); }

  private async tick() {
    if (this.stopped) return;
    const started = performance.now();
    try {
      const profile = this.adaptation.profile();
      await this.capture.frame(profile.width);
      this.frames += 1;
      if (started - this.lastStats >= STATS_INTERVAL) await this.updateStats(started);
      if (!this.stopped) this.timer = setTimeout(() => { void this.tick(); },
        Math.max(0, 1000 / profile.fps - (performance.now() - started)));
    } catch { this.fail(); }
  }

  private async updateStats(now: number) {
    const stats = await this.pc.getStats();
    if (this.stopped) return;
    const sample: NetworkSample = {};
    let encodedFps: number | undefined;
    let encodedWidth: number | undefined;
    let encodedHeight: number | undefined;
    let connection: 'direct' | 'relay' | undefined;
    let selectedPair: string | undefined;
    stats.forEach(report => { if (report.type === 'transport') selectedPair = report.selectedCandidatePairId; });
    stats.forEach(report => {
      if (report.type === 'candidate-pair'
        && (selectedPair ? report.id === selectedPair : report.state === 'succeeded' && report.nominated)) {
        sample.routeId = report.id;
        sample.bitrate = report.availableOutgoingBitrate; sample.rtt = report.currentRoundTripTime;
        connection = [report.localCandidateId, report.remoteCandidateId]
          .some(id => stats.get(id)?.candidateType === 'relay') ? 'relay' : 'direct';
      }
      if (report.type === 'remote-inbound-rtp' && report.kind === 'video') sample.loss = this.network.loss(report);
      if (report.type === 'outbound-rtp' && report.kind === 'video') {
        encodedFps = report.framesPerSecond;
        encodedWidth = report.frameWidth; encodedHeight = report.frameHeight;
        sample.sentBitrate = this.network.sentBitrate(report);
        sample.limited = ['bandwidth', 'cpu'].includes(report.qualityLimitationReason)
          ? report.qualityLimitationReason : undefined;
      }
    });
    this.adaptation.sample(sample);
    const profile = this.adaptation.profile();
    await this.applyProfile(profile);
    if (this.channel.readyState === 'open' && !this.stopped) {
      this.channel.send(JSON.stringify({ kind: 'stats', width: encodedWidth ?? this.capture.canvas.width,
        height: encodedHeight ?? this.capture.canvas.height,
        fps: Math.round(encodedFps ?? this.frames * 1000 / (now - this.lastStats)),
        bitrate: profile.bitrate, connection }));
    }
    this.frames = 0; this.lastStats = now;
  }

  private async applyProfile(profile = this.adaptation.profile()) {
    await configureDesktopSender(this.sender, profile);
  }

  private fail() {
    if (this.channel.readyState === 'open') {
      this.channel.send(JSON.stringify({ kind: 'error', message: '无法访问桌面，请确认电脑已解锁后重试。' }));
    }
    this.close();
  }
  get closed() { return this.stopped; }
  close() {
    if (this.stopped) return this.capture.close();
    this.stopped = true; clearTimeout(this.timer); clearTimeout(this.expires);
    this.direct.close(); this.standby?.close(); this.observer?.close(); this.diagnostic?.('desktop-closed');
    this.clipboardControls.close(); this.clipboardChannel.close();
    this.controls.close(); this.channel.close(); this.pc.close(); return this.capture.close();
  }
}
