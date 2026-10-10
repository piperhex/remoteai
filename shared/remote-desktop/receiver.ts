import type { DesktopCapabilities, DesktopClient, DesktopDisplays, DesktopInput, DesktopSettings, DesktopStats }
  from './protocol';
import { MAX_BUFFERED_INPUT, sendDesktopInput } from './input';
import { DesktopClipboard } from './clipboardTransfer';
import { MAX_CONTROL_MESSAGE_BYTES, type ClipboardReply } from './clipboard';
import { monitorDesktopStats } from './statsMonitor';
import { addIceCandidate } from '../remote-chat/iceCandidate';
import { desktopFailure } from './diagnostics';
import { RtcObserver } from '../remote-chat/rtcObserver';
import { connectionDiagnostic, type ConnectionDiagnostic, type DiagnosticFields } from '../remote-chat/diagnostics';
import { DesktopDirectUpgrade, type DirectPeer } from './directUpgrade';
import { DesktopRelayStandby } from './relayStandby';
import { DesktopDirectRetry } from './directRetry';
import { desktopVideoCodecs } from './codecs';
import { closeNativeMedia, openNativeMedia, nativeMediaIceServers, type NativeMediaSession } from './nativeMedia';

interface ReceiverOptions {
  client: DesktopClient;
  createPeer: (configuration: RTCConfiguration) => RTCPeerConnection;
  stream: (stream: MediaStream | undefined) => void;
  status: (status: string) => void;
  stats: (stats: DesktopStats) => void;
  audio?: (available: boolean) => void;
  displays?: (value: DesktopDisplays) => void;
  capabilities?: (value: DesktopCapabilities) => void;
  connected?: () => void;
  failed?: (message: string) => void;
  directRetry?: DesktopDirectRetry;
}
const SIGNAL_INTERVAL = 400;
const HEARTBEAT_INTERVAL = 2000;
const CONNECT_TIMEOUT = 25_000;
const RECOVERY_GRACE_MS = 8000;
const ACTIVE_HEARTBEAT_TIMEOUT_MS = 6000;
const CLOSE_TIMEOUT_MS = 4000;

/** Only signaling and small controls cross JS. Media stays in each platform's WebRTC engine. */
export class DesktopReceiver {
  private readonly id = `desktop-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  private pc?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private clipboardChannel?: RTCDataChannel;
  private candidates: RTCIceCandidateInit[] = [];
  private stopped = false;
  private closing?: Promise<void>;
  private poll?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private timeout?: ReturnType<typeof setTimeout>;
  private recoveryTimeout?: ReturnType<typeof setTimeout>;
  private stopStats?: () => void;
  private hostStats: DesktopStats = { width: 0, height: 0, fps: 0, bitrate: 0 };
  private measured: Partial<DesktopStats> = {};
  private media?: MediaStream;
  private muted = false;
  private readonly diagnostic: ConnectionDiagnostic;
  private observer?: RtcObserver;
  private upgrade?: DesktopDirectUpgrade;
  private readonly directRetry: DesktopDirectRetry;
  private standby?: DesktopRelayStandby;
  private readonly boundPeers = new WeakSet<RTCPeerConnection>();
  private readonly boundChannels = new WeakSet<RTCDataChannel>();
  private lastActivePong = 0;
  private nativeMedia?: NativeMediaSession;
  private nativeSelected = false;
  private capabilities: DesktopCapabilities = {};
  private audioTracks = new Set<MediaStreamTrack>();
  readonly clipboard = new DesktopClipboard(message => {
    const channel = this.clipboardChannel?.readyState === 'open' ? this.clipboardChannel : this.channel;
    if (this.stopped || channel?.readyState !== 'open' || channel.bufferedAmount > MAX_BUFFERED_INPUT) {
      return false;
    }
    channel.send(JSON.stringify(message)); return true;
  });
  constructor(private readonly options: ReceiverOptions) {
    this.directRetry = options.directRetry ?? new DesktopDirectRetry();
    const report = options.client.diagnostic ?? connectionDiagnostic(this.id, false);
    this.diagnostic = (event, fields) => report(event, { ...fields, scope: 'desktop' });
  }

  async start(settings: DesktopSettings) {
    let stage: DiagnosticFields['stage'] = 'request-open';
    this.options.status('正在连接桌面…');
    this.diagnostic('desktop-start');
    this.timeout = setTimeout(() => this.fail('桌面连接超时，请检查两端网络后重试。', 'timeout'), CONNECT_TIMEOUT);
    try {
      this.nativeMedia = await openNativeMedia(this.options.client.nativeMedia, this.id, this.diagnostic);
      if (this.stopped) { await closeNativeMedia(this.nativeMedia); return; }
      const videoCodecs = await desktopVideoCodecs();
      if (this.stopped) { await closeNativeMedia(this.nativeMedia); return; }
      const offer = await this.options.client.open(this.id, {
        ...settings, videoCodecs, clipboardChannel: true, nativeMedia: Boolean(this.nativeMedia), relayStandby: true,
      });
      stage = 'offer';
      if (this.stopped) { await this.closeRemote(); return; }
      this.capabilities = offer.capabilities ?? {}; this.options.capabilities?.(this.capabilities);
      this.options.displays?.(offer);
      if (!offer.nativeMedia) { await closeNativeMedia(this.nativeMedia); this.nativeMedia = undefined; }
      if (this.stopped) return;
      const iceServers = nativeMediaIceServers(offer.iceServers, this.nativeMedia?.endpoint);
      if (offer.relayStandby) this.standby = new DesktopRelayStandby({
        createPeer: this.options.createPeer, iceServers,
        signal: signal => this.options.client.signal(this.id, signal), activate: peer => this.activate(peer),
        failed: () => this.fail('桌面连接已断开，请重新连接。'),
      });
      const pc = this.options.createPeer({ iceServers });
      this.pc = pc;
      if (offer.directUpgrade) this.upgrade = new DesktopDirectUpgrade({
        retry: this.directRetry,
        createPeer: this.options.createPeer, iceServers, nativeMedia: this.nativeMedia, diagnostic: this.diagnostic,
        signal: signal => this.options.client.signal(this.id, signal), activate: peer => this.activate(peer),
      });
      this.observer = new RtcObserver(pc, this.diagnostic);
      this.bindPeer(pc);
      await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
      this.diagnostic('sdp-state', { stage: 'offer', direction: 'remote' });
      if (this.stopped) return;
      stage = 'answer';
      const answer = await pc.createAnswer();
      if (this.stopped) return;
      await pc.setLocalDescription(answer);
      this.diagnostic('sdp-state', { stage: 'answer', direction: 'local' });
      if (!this.stopped) await this.signal(answer.sdp);
    } catch (error) {
      const failure = desktopFailure(error);
      this.fail(error instanceof Error ? error.message : '暂时无法打开远程桌面，请重试。', failure.reason,
        { ...failure, stage });
    }
  }

  private bindPeer(pc: RTCPeerConnection) {
    if (this.boundPeers.has(pc)) return;
    this.boundPeers.add(pc);
    pc.addEventListener('icecandidate', event => {
      if (event.candidate && !this.stopped && this.pc === pc) this.candidates.push(event.candidate.toJSON());
    });
    pc.addEventListener('track', event => {
      if (this.stopped || this.pc !== pc) return;
      if (event.track.kind === 'audio') {
        this.audioTracks.add(event.track);
        event.track.enabled = !this.muted;
        this.options.audio?.(true);
      }
      this.media ??= event.streams[0];
      if (!this.media) return;
      if (!this.media.getTracks().some(track => track.id === event.track.id)) this.media.addTrack(event.track);
      this.options.stream(this.media);
    });
    pc.addEventListener('datachannel', event => { if (this.pc === pc) this.bindChannel(event.channel); });
    pc.addEventListener('connectionstatechange', () => {
      if (this.stopped || this.pc !== pc) return;
      if (pc.connectionState === 'connected') {
        clearTimeout(this.timeout); clearTimeout(this.recoveryTimeout);
        this.recoveryTimeout = undefined;
        this.options.status(''); this.options.connected?.();
        this.startStats(pc);
      } else if (['failed', 'closed'].includes(pc.connectionState) && !this.stopped) {
        this.recover();
      } else if (pc.connectionState === 'disconnected') {
        if (this.standby?.fallback()) { this.waitForFallback(); return; }
        this.options.status('网络中断，正在等待恢复…');
        this.recoveryTimeout ??= setTimeout(() => this.fail('桌面连接已断开，请重新连接。'), RECOVERY_GRACE_MS);
      }
    });
  }

  private startStats(pc: RTCPeerConnection) {
    this.stopStats ??= monitorDesktopStats(pc, stats => {
      const selected = stats.nativeMedia === true && stats.connection === 'direct';
      if (selected && !this.nativeSelected) this.diagnostic('path-selected', { transport: 'mesh', rttMs: stats.rttMs });
      this.nativeSelected = selected;
      this.measured = stats; this.options.stats({ ...this.hostStats, ...stats }); this.upgrade?.update(stats);
      this.standby?.update(stats.connection === 'direct');
      if (stats.nativeMedia && stats.connection !== 'direct' && this.standby?.fallback()) this.waitForFallback();
    }, this.nativeMedia);
  }

  private activate(peer: DirectPeer) {
    if (this.stopped) { peer.pc.close(); return; }
    const previous = this.pc;
    const backup = previous && this.media && this.channel && this.measured.connection === 'relay'
      ? { pc: previous, stream: this.media, channel: this.channel, clipboard: this.clipboardChannel } : undefined;
    clearTimeout(this.poll); clearTimeout(this.recoveryTimeout); clearInterval(this.heartbeat);
    this.recoveryTimeout = undefined;
    this.observer?.close(); this.stopStats?.(); this.stopStats = undefined;
    this.clipboard.cancel(); this.audioTracks.clear(); this.candidates.length = 0;
    this.pc = peer.pc; this.media = peer.stream; this.clipboardChannel = undefined;
    for (const track of peer.stream.getAudioTracks()) {
      track.enabled = !this.muted; this.audioTracks.add(track);
    }
    this.bindPeer(peer.pc); this.bindChannel(peer.channel);
    if (peer.clipboard) this.bindChannel(peer.clipboard);
    this.observer = new RtcObserver(peer.pc, this.diagnostic);
    void this.observer.snapshot();
    this.options.stream(peer.stream); this.options.audio?.(this.audioTracks.size > 0);
    this.measured = {}; this.hostStats = { width: 0, height: 0, fps: 0, bitrate: 0 };
    this.options.status(''); this.startStats(peer.pc);
    if (backup && this.standby) this.standby.retain(backup);
    else if (previous !== peer.pc) previous?.close();
  }

  private recover() {
    if (this.standby?.fallback()) { this.waitForFallback(); return; }
    this.fail('桌面连接已断开，请重新连接。');
  }

  private waitForFallback() {
    this.options.status('正在恢复桌面连接…');
    this.recoveryTimeout ??= setTimeout(() => this.fail('桌面连接已断开，请重新连接。'), RECOVERY_GRACE_MS);
  }

  private bindChannel(channel: RTCDataChannel) {
    if (this.stopped) { channel.close(); return; }
    const bound = this.boundChannels.has(channel);
    this.boundChannels.add(channel);
    if (channel.label === 'remote-desktop-clipboard') {
      this.clipboardChannel = channel;
      if (bound) return;
      channel.addEventListener('close', () => {
        if (this.clipboardChannel === channel) { this.clipboardChannel = undefined; this.clipboard.cancel(); }
      });
      channel.addEventListener('message', ({ data }) => {
        if (this.stopped || this.clipboardChannel !== channel
          || typeof data !== 'string' || data.length > MAX_CONTROL_MESSAGE_BYTES) return;
        try { this.clipboard.receive(JSON.parse(data) as ClipboardReply); }
        catch { this.clipboard.cancel(); }
      });
      return;
    }
    this.channel = channel;
    const opened = () => this.startHeartbeat(channel);
    if (channel.readyState === 'open') opened();
    if (bound) return;
    channel.addEventListener('open', opened);
    channel.addEventListener('close', () => {
      if (!this.stopped && this.channel === channel) this.recover();
    });
    channel.addEventListener('message', ({ data }) => {
      if (this.stopped || this.channel !== channel || typeof data !== 'string'
        || data.length > MAX_CONTROL_MESSAGE_BYTES) return;
      if (data === '{"kind":"pong"}') { this.lastActivePong = Date.now(); return; }
      try {
        const message = JSON.parse(data) as DesktopStats & { kind?: string; message?: string };
        if (message.kind === 'clipboard') { this.clipboard.receive(message as unknown as ClipboardReply); return; }
        if (message.kind === 'stats') {
          this.hostStats = message; this.options.stats({ ...message, ...this.measured });
        }
        if (message.kind === 'error') this.fail(message.message || '远程操作未完成，请重试。');
      } catch { this.fail('桌面连接异常，请重新连接。'); }
    });
  }

  private startHeartbeat(channel: RTCDataChannel) {
    if (this.stopped || this.channel !== channel) return;
    this.lastActivePong = Date.now();
    const ping = () => {
      if (this.standby && Date.now() - this.lastActivePong >= ACTIVE_HEARTBEAT_TIMEOUT_MS
        && this.standby.fallback()) this.waitForFallback();
      try { if (channel.readyState === 'open') channel.send('{"kind":"ping"}'); }
      catch { this.recover(); }
    };
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(ping, HEARTBEAT_INTERVAL); ping();
  }

  private async signal(answer?: string) {
    const pc = this.pc;
    if (this.stopped || !pc) return;
    try {
      const reply = await this.options.client.signal(this.id, { answer, candidates: this.candidates.splice(0) });
      if (this.stopped || this.pc !== pc) return;
      for (const candidate of reply.candidates) {
        if (this.stopped || this.pc !== pc) return;
        this.observer?.candidate(candidate, 'remote');
        await addIceCandidate(pc, candidate, this.diagnostic);
      }
      if (this.stopped || this.pc !== pc) return;
      // Single flight. Keep gathering late ICE candidates until connected, then stop polling.
      if (pc.connectionState !== 'connected' || this.candidates.length || pc.iceGatheringState !== 'complete') {
        this.poll = setTimeout(() => { void this.signal(); }, SIGNAL_INTERVAL);
      }
    } catch (error) {
      if (this.stopped || this.pc !== pc) return;
      const failure = desktopFailure(error);
      this.fail('桌面连接未能建立，请检查网络后重试。', failure.reason, { ...failure, stage: 'signal' });
    }
  }

  async privacy(enabled: boolean) {
    if (this.stopped || this.capabilities.control === false || !this.capabilities.privacyScreen
      || !this.options.client.privacy) throw new Error('这台电脑暂不支持隐私屏。');
    const snapshot = await this.options.client.privacy(this.id, enabled);
    if (this.stopped) throw new Error('桌面连接已结束。');
    this.options.displays?.(snapshot);
    return snapshot;
  }

  input(input: DesktopInput) {
    if (this.capabilities.control === false) return;
    if (input.kind === 'wheel' && input.horizontal && !this.capabilities.horizontalScroll) return;
    if (input.kind === 'keyboard' && !this.capabilities.keyboard) return;
    if (input.kind === 'button' && input.button === 'middle' && !this.capabilities.keyboard) return;
    if (!this.stopped) sendDesktopInput(this.channel, input);
  }
  mute(muted: boolean) {
    this.muted = muted;
    for (const track of this.audioTracks) track.enabled = !muted;
  }
  async settings(settings: DesktopSettings) {
    if (!this.stopped) await this.options.client.settings(this.id, settings);
  }
  private fail(message: string, reason: DiagnosticFields['reason'] = 'peer-failed', fields: DiagnosticFields = {}) {
    if (this.stopped) return;
    this.directRetry.update('relay');
    this.diagnostic('desktop-failed', { ...fields, reason });
    this.options.stream(undefined); this.options.status(message); this.stop();
    // Permission and platform refusals require a host-side change, not repeated connection attempts.
    if (!/未允许|不支持远程桌面/.test(message)) this.options.failed?.(message);
  }
  private async closeRemote() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.options.client.close(this.id),
        new Promise<void>(resolve => { timer = setTimeout(resolve, CLOSE_TIMEOUT_MS); })]);
    }
    catch { /* The host also expires disconnected sessions and releases held buttons. */ }
    finally {
      clearTimeout(timer);
      await closeNativeMedia(this.nativeMedia);
      this.nativeMedia = undefined;
    }
  }
  stop() {
    if (this.stopped) return this.closing ?? Promise.resolve();
    this.stopped = true;
    this.diagnostic('desktop-closed'); this.observer?.close();
    this.upgrade?.close();
    this.standby?.close();
    this.clipboard.stop();
    clearTimeout(this.poll); clearTimeout(this.timeout); clearInterval(this.heartbeat);
    clearTimeout(this.recoveryTimeout);
    this.stopStats?.();
    for (const track of this.audioTracks) { track.enabled = false; track.stop(); }
    this.audioTracks.clear(); this.media = undefined;
    this.options.audio?.(false);
    this.candidates.length = 0;
    this.clipboardChannel?.close(); this.channel?.close(); this.pc?.close();
    this.options.stream(undefined);
    this.closing = this.closeRemote();
    return this.closing;
  }
}
