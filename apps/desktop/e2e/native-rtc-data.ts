import { NativeRtcConnection } from '../src/nativeRtc/connection';
import { NativeRtcChannel } from '../src/nativeRtc/channel';

const wait = async (ready: () => boolean) => {
  const until = Date.now() + 15000;
  while (!ready()) {
    if (Date.now() > until) throw new Error('Native channel fixture timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

/** Real Rust peers and raw IPC. Verifies record boundaries and cancellation across the desktop bridge. */
export async function nativeDataFixture() {
  const sender = new NativeRtcConnection({}); const receiver = new NativeRtcConnection({});
  const outgoing = sender.createDataChannel('remote-ai-file-v1', { negotiated: true, id: 42 });
  const incoming = receiver.createDataChannel('remote-ai-file-v1', { negotiated: true, id: 42 });
  const chat = sender.createDataChannel('codex-chat-v1');
  const senderCandidates: RTCIceCandidateInit[] = [], receiverCandidates: RTCIceCandidateInit[] = [];
  sender.addEventListener('icecandidate', event => senderCandidates.push(
    (event as Event & { candidate: RTCIceCandidateInit }).candidate));
  receiver.addEventListener('icecandidate', event => receiverCandidates.push(
    (event as Event & { candidate: RTCIceCandidateInit }).candidate));
  let reply: NativeRtcChannel | undefined;
  receiver.addEventListener('datachannel', event => { reply = (event as Event & { channel: NativeRtcChannel }).channel; });
  let received = 0; let failure: string | undefined;
  const recordBytes = 16384, count = 128;
  incoming.addEventListener('message', event => {
    const bytes = new Uint8Array((event as MessageEvent<ArrayBuffer>).data);
    if (bytes.length !== recordBytes || new DataView(bytes.buffer).getUint32(0) !== received
      || bytes[bytes.length - 1] !== 37) failure = 'Corrupt or out-of-order native record';
    received += 1;
  });
  try {
    await sender.setLocalDescription(await sender.createOffer());
    await wait(() => sender.iceGatheringState === 'complete');
    await receiver.setRemoteDescription(sender.localDescription!);
    for (const candidate of senderCandidates) await receiver.addIceCandidate(candidate);
    await receiver.setLocalDescription(await receiver.createAnswer());
    await wait(() => receiver.iceGatheringState === 'complete');
    await sender.setRemoteDescription(receiver.localDescription!);
    for (const candidate of receiverCandidates) await sender.addIceCandidate(candidate);
    await wait(() => outgoing.readyState === 'open' && incoming.readyState === 'open' && reply?.readyState === 'open');
    let echoed = false;
    reply!.addEventListener('message', event => reply!.send((event as MessageEvent<string>).data));
    chat.addEventListener('message', event => { echoed = (event as MessageEvent<string>).data === 'native-echo'; });
    chat.send('native-echo');
    for (let index = 0; index < count; index += 1) {
      await wait(() => outgoing.bufferedAmount < 256 * 1024);
      const bytes = new Uint8Array(recordBytes).fill(37); new DataView(bytes.buffer).setUint32(0, index);
      outgoing.send(bytes);
    }
    await wait(() => received === count && echoed);
    if (failure) throw new Error(failure);
    return { records: received, bytes: received * recordBytes, chatEcho: echoed };
  } catch (error) {
    console.error('Native data fixture state', JSON.stringify({ sender: sender.connectionState,
      receiver: receiver.connectionState, outgoing: outgoing.readyState, incoming: incoming.readyState,
      chat: chat.readyState, reply: reply?.readyState, senderCandidates, receiverCandidates, received }));
    throw error;
  } finally { sender.close(); receiver.close(); }
}
