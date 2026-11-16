import { invoke } from '@tauri-apps/api/core';
import { NativeRtcChannel } from './channel';
import type { NativeRtcEvent, NativeRtcOperation } from './types';
import { NativeRtcMedia } from './media';
import { readNativePackets } from './packets';

/** Implements only the standard RTC subset consumed by the shared chat/desktop controllers. */
export class NativeRtcConnection extends EventTarget {
  id?: string;
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  iceGatheringState: RTCIceGatheringState = 'new';
  signalingState: RTCSignalingState = 'stable';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  readonly sctp = { maxMessageSize: 64 * 1024 };
  private readonly ready: Promise<string>;
  private readonly channels = new Map<string, NativeRtcChannel>();
  private outgoing = Promise.resolve<unknown>(undefined);
  private disposed = false;
  private receiving = false;
  private notified = false;
  private media?: NativeRtcMedia;
  private readonly earlyOpen = new Set<string>();

  constructor(configuration: RTCConfiguration, receiveMedia = false) {
    super();
    if (receiveMedia) this.media = new NativeRtcMedia(track => this.dispatchEvent(Object.assign(new Event('track'), {
      track, streams: [this.media!.stream],
    })), () => { void this.perform({ kind: 'keyFrame' }).catch(() => {}); });
    this.ready = invoke<string>('native_rtc_open', { configuration: {
      relayOnly: configuration.iceTransportPolicy === 'relay',
      receiveMedia,
      iceServers: (configuration.iceServers ?? []).map(server => ({
        urls: typeof server.urls === 'string' ? [server.urls] : server.urls,
        username: server.username ?? '', credential: server.credential ?? '',
      })),
    } });
    void this.ready.then(id => {
      this.id = id;
      if (this.disposed) void invoke('native_rtc_close', { id }).catch(() => {});
      else void this.poll();
    }).catch(() => this.failed());
  }

  perform<T>(operation: NativeRtcOperation): Promise<T> {
    const task = this.outgoing.then(async () => {
      const id = await this.ready;
      if (this.disposed) throw new DOMException('RTC peer is closed', 'InvalidStateError');
      return invoke<T>('native_rtc_operation', { request: { id, operation } });
    });
    this.outgoing = task.catch(() => undefined);
    return task;
  }

  createDataChannel(label: string, options: RTCDataChannelInit = {}) {
    if (options.ordered === false || options.maxRetransmits != null || options.maxPacketLifeTime != null) {
      throw new DOMException('Unreliable channels are not supported', 'NotSupportedError');
    }
    const spec = { key: crypto.randomUUID(), label, negotiated: options.negotiated ? options.id : null };
    const channel = new NativeRtcChannel(spec, this);
    this.channels.set(spec.key, channel);
    void this.perform({ kind: 'createChannel', channel: spec }).catch(() => channel.closed());
    return channel;
  }

  createOffer() { return this.perform<RTCSessionDescriptionInit>({ kind: 'offer' }); }
  createAnswer() { return this.perform<RTCSessionDescriptionInit>({ kind: 'answer' }); }
  async setLocalDescription(description: RTCSessionDescriptionInit) {
    await this.perform({ kind: 'local', description }); this.localDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
    this.dispatchEvent(new Event('signalingstatechange'));
  }
  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    await this.perform({ kind: 'remote', description }); this.remoteDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
    this.dispatchEvent(new Event('signalingstatechange'));
  }
  addIceCandidate(candidate: RTCIceCandidateInit) { return this.perform<void>({ kind: 'candidate', candidate }); }

  async send(key: string, bytes: Uint8Array, text: boolean) {
    const id = await this.ready;
    if (this.disposed) throw new DOMException('RTC peer is closed', 'InvalidStateError');
    await invoke('native_rtc_send', bytes, {
      headers: { 'x-rtc-peer': id, 'x-rtc-channel': key, 'x-rtc-type': text ? 'text' : 'binary' },
    });
  }

  async getStats() {
    const reports = await this.perform<Record<string, RTCStats>>({ kind: 'stats' });
    const result = new Map(Object.entries(reports).map(([id, report]) =>
      [id, { ...report, timestamp: report.timestamp * 1000 }]));
    if (this.media) {
      const video = [...result.values()].find(report => report.type === 'inbound-rtp'
        && (report as RTCInboundRtpStreamStats).kind === 'video');
      if (video) result.delete(video.id);
      result.set('native-video', { ...video, ...this.media.stats() });
      result.set('native-video-codec', this.media.codecStats());
    }
    return result;
  }

  private async poll() {
    try {
      while (!this.disposed) {
        const events = await invoke<NativeRtcEvent[]>('native_rtc_poll', { id: this.id });
        for (const event of events) { if (!this.disposed) this.receive(event); }
      }
    } catch (error) { if (!this.disposed) { console.error('Native RTC event poll failed', error); this.failed(); } }
  }

  private receive(event: NativeRtcEvent) {
    switch (event.kind) {
      case 'candidate': this.dispatchEvent(Object.assign(new Event('icecandidate'), {
        candidate: { ...event.candidate, toJSON: () => event.candidate },
      })); break;
      case 'state':
        this.connectionState = event.state;
        this.iceConnectionState = event.state === 'connecting' ? 'checking' : event.state;
        this.dispatchEvent(new Event('iceconnectionstatechange'));
        this.dispatchEvent(new Event('connectionstatechange')); break;
      case 'gathering': this.iceGatheringState = event.state;
        if (event.description) this.localDescription = event.description;
        this.dispatchEvent(new Event('icegatheringstatechange')); break;
      case 'channel': {
        const channel = new NativeRtcChannel(event.channel, this);
        this.channels.set(event.channel.key, channel);
        this.dispatchEvent(Object.assign(new Event('datachannel'), { channel }));
        if (this.earlyOpen.delete(event.channel.key)) channel.opened(); break;
      }
      case 'open':
        if (this.channels.has(event.key)) this.channels.get(event.key)!.opened();
        else this.earlyOpen.add(event.key); break;
      case 'close': this.channels.get(event.key)?.closed(); break;
      case 'text': this.channels.get(event.key)?.receive(event.text); break;
      case 'binaryReady': this.notified = true; void this.readBinary(); break;
      case 'closed': this.close(); break;
    }
  }

  private async readBinary() {
    if (this.receiving) return;
    this.receiving = true;
    try {
      do {
        this.notified = false;
        while (!this.disposed) {
          const packet = await invoke<ArrayBuffer>('native_rtc_receive', { id: this.id });
          if (!packet.byteLength) break;
          readNativePackets(packet, (header, bytes) => {
            if (header.kind === 'data') this.channels.get(header.key)?.receive(bytes.slice().buffer);
            else this.media?.receive(header, bytes);
          });
        }
      } while (this.notified && !this.disposed);
    } catch (error) { if (!this.disposed) { console.error('Native RTC packet receive failed', error); this.failed(); } }
    finally { this.receiving = false; }
  }

  private failed() {
    if (this.disposed) return;
    this.connectionState = 'failed'; this.dispatchEvent(new Event('connectionstatechange')); this.close();
  }

  close() {
    if (this.disposed) return;
    this.disposed = true; this.connectionState = 'closed'; this.iceConnectionState = 'closed';
    for (const channel of this.channels.values()) channel.closed();
    this.channels.clear(); this.dispatchEvent(new Event('connectionstatechange'));
    this.earlyOpen.clear(); this.media?.close();
    if (this.id) void invoke('native_rtc_close', { id: this.id }).catch(() => {});
  }
}

export function createNativeRtcConnection(configuration: RTCConfiguration, receiveMedia = false): RTCPeerConnection {
  // Shared controllers use the documented RTC subset; no browser RTCPeerConnection is constructed here.
  return new NativeRtcConnection(configuration, receiveMedia) as unknown as RTCPeerConnection;
}
