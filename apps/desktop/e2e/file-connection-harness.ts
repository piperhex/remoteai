import { HotLink } from '../../../shared/remote-chat/hotLink';
import { RtcPeer } from '../../../shared/remote-chat/rtcPeer';
import { FileRelay } from '../../../shared/remote-chat/fileRelay';
import { keyPair } from '../../../shared/remote-chat/cipher';
import type { RpcMessage, Signal } from '../../../shared/remote-chat/protocol';

type Side = 'host' | 'viewer';
const opposite = (side: Side): Side => side === 'host' ? 'viewer' : 'host';
const wait = async (condition: () => boolean) => {
  const deadline = Date.now() + 15_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Harness timeout');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};
async function exercise(url: string, direct: boolean) {
  const sessionId = crypto.randomUUID();
  const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
  const keys = { host: keyPair(random), viewer: keyPair(random) };
  const links = {} as Record<Side, HotLink>;
  const peers: Record<Side, RtcPeer[]> = { host: [], viewer: [] };
  const messages: Record<Side, RpcMessage[]> = { host: [], viewer: [] };
  const errors: string[] = [];
  for (const side of ['host', 'viewer'] as const) {
    const target = opposite(side);
    const relay = new FileRelay({ sessionId, url: () => url,
      fallback: { available: () => false, send: async () => { throw new Error('Chat bulk fallback'); } },
      record: bytes => links[side].bulk.receive(bytes, 'relay'), changed: () => links[side]?.bulk.relayChanged(),
      quota: () => { throw new Error('Unexpected quota'); },
    });
    links[side] = new HotLink({ sessionId, desktop: side === 'host', secret: keys[side].secret,
      publicKey: keys[target].publicKey, iceServers: [], binaryBulk: true, bulkRelay: relay,
      createPeer: options => {
        if (!direct) throw new Error('Relay-only fixture');
        const peer = new RtcPeer(options, () => new RTCPeerConnection({ iceServers: [] }));
        peers[side].push(peer); return peer;
      },
      signal: value => {
        const frame = value as { type: string; payload: string | Signal };
        queueMicrotask(() => {
          if (frame.type === 'relay') links[target].receive(frame.payload as string);
          if (frame.type === 'signal') void links[target].acceptSignal(frame.payload as Signal);
        });
      },
      relayBuffered: () => 0, message: message => messages[side].push(message), mode() {}, error: error => errors.push(error),
    });
    relay.configure({ version: 1, ticket: side });
  }
  try {
    await links.viewer.offer();
    await wait(() => links.host.connectionMode !== 'connecting' && links.viewer.connectionMode !== 'connecting');
    await wait(() => links.host.bulk.path === (direct ? 'direct' : 'relay')
      && links.viewer.bulk.path === (direct ? 'direct' : 'relay'));
    const context = { transferId: crypto.randomUUID(), epoch: crypto.randomUUID(), manifestId: 'f'.repeat(64) };
    const source = links.host.createBulkCipher(context), receiver = links.viewer.createBulkCipher(context);
    const requestId = crypto.randomUUID();
    let bytes = 0;
    const failed: string[] = [];
    const path = direct ? 'direct' : 'relay';
    const unlisten = links.viewer.bulk.listen(context.transferId, { epoch: context.epoch, path,
      record: record => { const decoded = receiver.decrypt(record); bytes += decoded.bytes.length; },
      failed: error => failed.push(error.code) });
    const payload = new Uint8Array(16_000).fill(73);
    const signal = new AbortController().signal;
    for (let block = 0; block < 4; block++) {
      for (let part = 0; part < 64; part++) {
        await links.host.bulk.send(source.encrypt({ requestId, block, offset: part * payload.length }, payload), path, signal);
        if (part % 16 === 0) await links.host.send({ kind: 'event', event: 'chat-during-download' });
      }
    }
    await wait(() => bytes === 4 * 64 * payload.length);
    unlisten(); source.destroy(); receiver.destroy();
    if (direct) {
      if (peers.host.length !== 2 || peers.viewer.length !== 2) throw new Error('Files shared the chat peer');
      peers.host[1].close(); peers.viewer[1].close();
      await links.host.send({ kind: 'event', event: 'chat-after-file-close' });
      await wait(() => messages.viewer.some(message => message.kind === 'event' && message.event === 'chat-after-file-close'));
    }
    return { bytes, errors, failed, chat: messages.viewer.length, peers: peers.viewer.length,
      mode: links.viewer.connectionMode };
  } finally { links.host.close(); links.viewer.close(); }
}
declare global { interface Window { exerciseFileConnections: typeof exercise } }
window.exerciseFileConnections = exercise;
