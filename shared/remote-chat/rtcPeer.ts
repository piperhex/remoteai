import type { Channel, Peer, PeerOptions, Signal } from './protocol';
import { addIceCandidate } from './iceCandidate';
import { RtcObserver } from './rtcObserver';
import { binaryDataChannel } from './bulkRtc';

const MAX_PENDING_CANDIDATES = 128;

function dataChannel(channel: RTCDataChannel, observer: RtcObserver): Channel {
  return {
    get connectionEndpoints() { return channel.readyState === 'open' ? observer.connectionEndpoints : undefined; },
    get readyState() { return channel.readyState; },
    get bufferedAmount() { return channel.bufferedAmount; },
    send: (data) => channel.send(data),
    close: () => channel.close(),
    onOpen: (callback) => channel.addEventListener('open', () => { void observer.snapshot(); callback(); }),
    onClose: (callback) => {
      channel.addEventListener('close', callback);
      channel.addEventListener('error', callback);
    },
    onMessage: (callback) => channel.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (typeof event.data === 'string') callback(event.data);
    }),
  };
}

/** The browser and React Native adapter both implement the standard data-channel subset. */
export class RtcPeer implements Peer {
  private readonly pc: RTCPeerConnection;
  private readonly candidates: RTCIceCandidateInit[] = [];
  private incoming = Promise.resolve();
  private closed = false;
  private readonly observer: RtcObserver;

  constructor(private readonly options: PeerOptions, create: () => RTCPeerConnection) {
    this.pc = create();
    // Negotiated ID prevents old peers from mistaking a new incoming channel for their RPC channel.
    if (options.bulkChannel) options.bulkChannel(binaryDataChannel(this.pc.createDataChannel('remote-ai-file-v1',
      { negotiated: true, id: 42, ordered: true }), () => this.pc.sctp?.maxMessageSize));
    this.observer = new RtcObserver(this.pc, options.diagnostic);
    this.pc.addEventListener('icecandidate', ({ candidate }) => {
      if (!this.closed && candidate) options.signal({ kind: 'ice', candidate: candidate.candidate,
        sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex });
    });
    this.pc.addEventListener('datachannel', ({ channel }) => options.channel(dataChannel(channel, this.observer)));
    this.pc.addEventListener('connectionstatechange', () => {
      if (this.closed) return;
      const state = this.pc.connectionState;
      options.stateChanged?.(state);
      if (['failed', 'disconnected', 'closed'].includes(state)) options.disconnected();
    });
  }

  async offer() {
    this.options.channel(dataChannel(this.pc.createDataChannel('codex-chat-v1', { ordered: true }), this.observer));
    const offer = await this.pc.createOffer();
    if (this.closed) return;
    await this.pc.setLocalDescription(offer);
    if (this.closed) return;
    this.options.diagnostic?.('sdp-state', { transport: 'rtc', stage: 'offer', direction: 'local' });
    this.options.signal({ kind: 'sdp', type: 'offer', sdp: offer.sdp ?? '' });
  }

  accept(signal: Exclude<Signal, { kind: 'key' }>): Promise<void> {
    const result = this.incoming.then(() => this.apply(signal));
    this.incoming = result.catch(() => undefined);
    return result;
  }

  private async apply(signal: Exclude<Signal, { kind: 'key' }>) {
    if (this.closed) return;
    if (signal.kind === 'tcp') return;
    if (signal.kind === 'ice') {
      this.observer?.candidate(signal, 'remote');
      if (this.pc.remoteDescription) await this.addCandidate(signal);
      else if (this.candidates.length < MAX_PENDING_CANDIDATES) this.candidates.push(signal);
      else this.options.diagnostic?.('candidate-rejected', { transport: 'rtc', reason: 'candidate-limit' });
      return;
    }
    await this.pc.setRemoteDescription({ type: signal.type, sdp: signal.sdp });
    this.options.diagnostic?.('sdp-state', { transport: 'rtc', stage: signal.type, direction: 'remote' });
    for (const candidate of this.candidates.splice(0)) await this.addCandidate(candidate);
    if (signal.type !== 'offer' || this.closed) return;
    const answer = await this.pc.createAnswer();
    if (this.closed) return;
    await this.pc.setLocalDescription(answer);
    if (this.closed) return;
    this.options.diagnostic?.('sdp-state', { transport: 'rtc', stage: 'answer', direction: 'local' });
    this.options.signal({ kind: 'sdp', type: 'answer', sdp: answer.sdp ?? '' });
  }

  private async addCandidate(candidate: RTCIceCandidateInit) {
    if (this.closed) return;
    await addIceCandidate(this.pc, candidate, this.options.diagnostic);
  }

  close() {
    this.closed = true;
    this.observer?.close();
    this.candidates.length = 0;
    this.pc.close();
  }
}
