import { afterEach, expect, it, vi } from 'vitest';
import { TcpChannel } from '../../../../shared/remote-chat/tcp/channel';
import { bindingAddress } from '../../../../shared/remote-chat/tcp/binding';
import { validTcpAddress, type TcpSocket } from '../../../../shared/remote-chat/tcp/types';
import { MultipathChannel } from '../../../../shared/remote-chat/multipathChannel';
import { MultipathPeer } from '../../../../shared/remote-chat/multipathPeer';
import type { Channel } from '../../../../shared/remote-chat/protocol';

function sockets(transform: (data: Uint8Array, side: number) => Uint8Array = bytes => bytes) {
  const receivers: Array<((data: Uint8Array) => void) | undefined> = [];
  const queues: Uint8Array[][] = [[], []];
  const closed = [false, false], callbacks: Array<() => void> = [];
  return [0, 1].map(side => ({
    localAddress: '192.168.1.5', localPort: 45000 + side, bufferedAmount: 0,
    write: (bytes: Uint8Array) => queueMicrotask(() => {
      if (closed[side]) return;
      bytes = transform(bytes, side);
      const peer = 1 - side;
      // Exercise partial TCP reads, including splits within the four-byte frame header.
      for (const part of [bytes.slice(0, 2), bytes.slice(2, 11), bytes.slice(11)].filter(part => part.length)) {
        if (receivers[peer]) receivers[peer]!(part); else queues[peer].push(part);
      }
    }),
    onData: (callback: (data: Uint8Array) => void) => {
      receivers[side] = callback; queues[side].splice(0).forEach(callback);
    },
    onClose: (callback: () => void) => { callbacks[side] = callback; },
    close: () => { if (!closed[side]) { closed[side] = true; callbacks[side]?.(); } },
  } satisfies TcpSocket));
}

it('authenticates both roles before carrying fragmented encrypted payloads', async () => {
  const pair = sockets();
  const peers = pair.map((socket, side) => new TcpChannel({ socket, key: new Uint8Array(32).fill(7),
    sessionId: 'paired-session', desktop: side === 0, random: size => new Uint8Array(size).fill(side + 1) }));
  try {
    const received = vi.fn(); peers[1].onMessage(received);
    expect(() => peers[0].send('early')).toThrow();
    await vi.waitFor(() => expect(peers.map(peer => peer.readyState)).toEqual(['open', 'open']));
    const payload = 'ab'.repeat(30_000);
    peers[0].send(payload);
    await vi.waitFor(() => expect(received).toHaveBeenCalledWith(payload));
  } finally { peers.forEach(peer => peer.close()); }
});

it.each(['wrong-key', 'wrong-session', 'reflected-role'])('rejects %s TCP handshakes', async failure => {
  const pair = sockets();
  const peers = pair.map((socket, side) => new TcpChannel({ socket,
    key: new Uint8Array(32).fill(failure === 'wrong-key' ? side + 1 : 7),
    sessionId: failure === 'wrong-session' ? `session-${side}` : 'same-session',
    desktop: failure === 'reflected-role' || side === 0, random: size => new Uint8Array(size).fill(side + 1) }));
  try { await vi.waitFor(() => expect(peers.some(peer => peer.readyState === 'closed')).toBe(true)); }
  finally { peers.forEach(peer => peer.close()); }
});

it('checks STUN transactions and parses both IPv4 and IPv6 mapped addresses', () => {
  const request = new Uint8Array(20); new DataView(request.buffer).setUint32(4, 0x2112a442);
  for (const [family, ip, host] of [
    [1, [192, 0, 2, 10], '192.0.2.10'],
    [2, [32, 1, 13, 184, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], '2001:db8:0:0:0:0:0:1'],
  ] as const) {
    const response = new Uint8Array(28 + ip.length), view = new DataView(response.buffer);
    response.set(request); view.setUint16(0, 0x101); view.setUint16(2, response.length - 20);
    view.setUint16(20, 0x20); view.setUint16(22, ip.length + 4); response[25] = family;
    view.setUint16(26, 45000 ^ 0x2112);
    ip.forEach((byte, index) => { response[28 + index] = byte ^ request[4 + index]; });
    expect(bindingAddress(response, request)).toEqual({ host, port: 45000 });
    response[8] ^= 1;
    expect(bindingAddress(response, request)).toBeUndefined();
  }
});

it('rejects loopback, link-local, multicast and privileged candidate destinations', () => {
  for (const host of ['127.0.0.1', '0.0.0.0', '169.254.1.5', '224.0.0.1', '::1', 'fe80::1', 'ff02::1',
    '2001:::1', '2001:db8:', '2001:db8::12345', '2001:1:2:3:4:5:6:7:8', 'fd00::1::2', '3:4']) {
    expect(validTcpAddress({ host, port: 45000 })).toBe(false);
  }
  expect(validTcpAddress({ host: '192.168.1.5', port: 80 })).toBe(false);
  expect(validTcpAddress({ host: '192.168.1.5', port: 45000 })).toBe(true);
  expect(validTcpAddress({ host: '2001:db8::1', port: 45000 })).toBe(true);
});

it.each(['tampered', 'replayed'])('closes a path carrying a %s encrypted record', async failure => {
  let armed = false, previous: Uint8Array | undefined;
  const pair = sockets((bytes, side) => {
    if (!armed || side !== 0) return bytes;
    if (failure === 'tampered') { bytes[bytes.length - 1] ^= 1; return bytes; }
    previous ??= bytes;
    return previous;
  });
  const peers = pair.map((socket, side) => new TcpChannel({ socket, key: new Uint8Array(32).fill(7),
    sessionId: 'session', desktop: side === 0, random: size => new Uint8Array(size).fill(side + 1) }));
  try {
    await vi.waitFor(() => expect(peers.every(peer => peer.readyState === 'open')).toBe(true));
    const received = vi.fn(); peers[1].onMessage(received); armed = true;
    peers[0].send('first');
    if (failure === 'replayed') {
      await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(1));
      peers[0].send('second');
    }
    await vi.waitFor(() => expect(peers[1].readyState).toBe('closed'));
    expect(received).toHaveBeenCalledTimes(failure === 'replayed' ? 1 : 0);
  } finally { peers.forEach(peer => peer.close()); }
});

afterEach(() => vi.useRealTimers());

function path() {
  let receiver: (text: string) => void = () => undefined;
  let alive = true;
  const send = vi.fn((text: string) => {
    const [kind, sequence] = JSON.parse(text) as [string, number];
    if (alive && kind === 'ping') receiver(JSON.stringify(['pong', sequence]));
  });
  return { silence: () => { alive = false; }, send, channel: {
    readyState: 'open', bufferedAmount: 0, send, close: vi.fn(), onOpen: vi.fn(), onClose: vi.fn(),
    onMessage: (callback: (text: string) => void) => { receiver = callback; },
  } satisfies Channel };
}

it('uses TCP while UDP is unavailable, prefers working UDP, then escapes a UDP black hole', () => {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  const disconnected = vi.fn(), opened = vi.fn(), channel = new MultipathChannel({ disconnected });
  const tcp = path(), udp = path();
  channel.onOpen(opened);
  channel.add(tcp.channel, 1);
  channel.send('tcp data');
  expect(tcp.send).toHaveBeenLastCalledWith(JSON.stringify(['data', 'tcp data']));
  channel.add(udp.channel, 0);
  channel.send('udp data');
  expect(udp.send).toHaveBeenLastCalledWith(JSON.stringify(['data', 'udp data']));
  udp.silence(); vi.advanceTimersByTime(3100);
  channel.send('recovered');
  expect(tcp.send).toHaveBeenLastCalledWith(JSON.stringify(['data', 'recovered']));
  expect(disconnected).not.toHaveBeenCalled();
  channel.close();
  expect(vi.getTimerCount()).toBe(0);
});

it('exposes native RTC submission only for the selected path and preserves wrapper depth', () => {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  const channel = new MultipathChannel({ disconnected: vi.fn() });
  const tcp = path(), rtc = path(), target = { peer: 'peer', channel: 'channel', envelopes: 1 };
  channel.add(tcp.channel, 1);
  expect(channel.nativeChatTarget).toBeUndefined();
  channel.add({ ...rtc.channel, nativeChatTarget: target }, 0);
  expect(channel.nativeChatTarget).toEqual({ ...target, envelopes: 2 });
  rtc.silence(); vi.advanceTimersByTime(3100);
  expect(channel.nativeChatTarget).toBeUndefined();
  channel.close();
});

it('isolates RTC negotiation errors and cleans every path when the aggregate closes', async () => {
  vi.useFakeTimers();
  const channel = vi.fn(), close = vi.fn(), stopNetwork = vi.fn();
  const peer = new MultipathPeer({ sessionId: 'session', desktop: true, iceServers: [], signal: vi.fn(),
    tcp: { servers: [{ host: 'discovery.example', port: 3478 }] }, channel, disconnected: vi.fn() }, {
    random: size => new Uint8Array(size).fill(9),
    rtc: () => ({ offer: async () => { throw new Error('RTC unavailable'); },
      accept: async () => { throw new Error('RTC negotiation failed'); }, close }),
    network: { listen: async () => { throw new Error('TCP unavailable'); },
      connect: async () => { throw new Error('TCP unavailable'); }, close: stopNetwork },
  });
  await expect(peer.offer()).resolves.toBeUndefined();
  await expect(peer.accept({ kind: 'sdp', type: 'answer', sdp: 'unusable' })).resolves.toBeUndefined();
  expect(channel).toHaveBeenCalledTimes(1);
  peer.close();
  expect(close).toHaveBeenCalledTimes(1);
  expect(stopNetwork).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
