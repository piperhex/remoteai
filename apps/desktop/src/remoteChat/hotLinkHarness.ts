import { vi } from 'vitest';
import { HotLink } from '../../../../shared/remote-chat/hotLink';
import { keyPair, SessionCipher } from '../../../../shared/remote-chat/cipher';
import { directPackets } from '../../../../shared/remote-chat/directPackets';
import type { Channel, PeerOptions, RpcMessage } from '../../../../shared/remote-chat/protocol';
import type { ConnectionEndpoints } from '../../../../shared/remote-chat/connectionEndpoints';

type Side = 'phone' | 'pc';
type Path = 'direct' | 'relay';
interface Packet { side: Side; path: Path; payload: string; frame: Record<string, unknown> }

export function hotLinkHarness(options: {
  relayDelay?: number; endpoints?: Partial<Record<Side, ConnectionEndpoints>>;
  wrapDirectChannel?: (channel: Channel) => Channel;
} = {}) {
  const keys = { phone: keyPair((size) => crypto.getRandomValues(new Uint8Array(size))),
    pc: keyPair((size) => crypto.getRandomValues(new Uint8Array(size))) };
  const messages = { phone: [] as RpcMessage[], pc: [] as RpcMessage[] };
  const modes = { phone: [] as string[], pc: [] as string[] };
  const links = {} as Record<Side, HotLink>;
  const peers = {} as Record<Side, PeerOptions>;
  const channels = {} as Record<Side, Channel>;
  const endpoints = { ...options.endpoints };
  const receive = {} as Record<Side, (payload: string) => void>;
  const paths = { direct: true, relay: true };
  const packets: Packet[] = [];
  let filter = (_packet: Packet) => true;
  const opposite = (side: Side): Side => side === 'phone' ? 'pc' : 'phone';
  const error = vi.fn();
  const reconnect = vi.fn();
  const inspectors = {} as Record<Side, SessionCipher>;
  const deliver = (packet: Packet) => {
    const target = opposite(packet.side);
    if (packet.path === 'direct') receive[target]?.(packet.payload);
    else links[target].receive(packet.payload);
  };
  const send = (side: Side, path: Path, payload: string) => {
    for (const part of path === 'direct' ? directPackets(payload) : [payload]) {
      const frame = JSON.parse(inspectors[side].decrypt(part)!) as Record<string, unknown>;
      const packet = { side, path, payload: part, frame };
      packets.push(packet);
      if (paths[path] && filter(packet)) {
        if (path === 'relay' && options.relayDelay) setTimeout(() => deliver(packet), options.relayDelay);
        else queueMicrotask(() => deliver(packet));
      }
    }
  };
  for (const side of ['phone', 'pc'] as const) {
    const other = opposite(side);
    inspectors[side] = new SessionCipher({ sessionId: 'session', desktop: side !== 'pc',
      secret: keys[other].secret, publicKey: keys[side].publicKey });
    links[side] = new HotLink({ sessionId: 'session', desktop: side === 'pc',
      secret: keys[side].secret, publicKey: keys[other].publicKey, iceServers: [],
      createPeer: (options) => {
        peers[side] = options;
        return { offer: async () => undefined, accept: async () => undefined, close() {} };
      },
      signal: (value) => {
        const frame = value as { type: string; payload: string };
        if (frame.type === 'relay') send(side, 'relay', frame.payload);
      },
      relayBuffered: () => 0, reconnectRelay: reconnect,
      message: (message) => messages[side].push(message), mode: (mode) => modes[side].push(mode), error,
    });
    channels[side] = { readyState: 'open', bufferedAmount: 0, close() {},
      get connectionEndpoints() { return endpoints[side]; },
      send: (payload) => send(side, 'direct', payload), onOpen() {}, onClose() {},
      onMessage: (callback) => { receive[side] = callback; } };
  }
  for (const side of ['phone', 'pc'] as const) {
    peers[side].channel(options.wrapDirectChannel?.(channels[side]) ?? channels[side]);
  }
  return { links, messages, modes, paths, packets, error, reconnect, deliver, endpoints,
    filter: (callback: typeof filter) => { filter = callback; },
    restoreRelay: () => { paths.relay = true; links.phone.enableRelay(); links.pc.enableRelay(); },
    close: () => { links.phone.close(); links.pc.close(); } };
}
