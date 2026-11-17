import { beforeEach, expect, it, vi } from 'vitest';
import { TcpPeer } from '../../../../shared/remote-chat/tcp/peer';
import type { TcpNetwork, TcpSocket } from '../../../../shared/remote-chat/tcp/types';
import { DesktopTcpChannel } from './tcpChannel';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
beforeEach(() => mocks.invoke.mockReset());

it('waits for native key agreement, retains early candidates and wipes keys resolved after close', async () => {
  let resolve!: (pair: { secret: Uint8Array; publicKey: string }) => void;
  const network: TcpNetwork = { crypto: { keyPair: () => new Promise(done => { resolve = done; }),
    channel: vi.fn() }, listen: vi.fn(), connect: vi.fn(), close: vi.fn() };
  const signal = vi.fn(), random = vi.fn(() => { throw new Error('JS key derivation used'); });
  const peer = new TcpPeer({ sessionId: 'native', desktop: true, config: { servers: [] },
    random, signal, channel: vi.fn() }, network);
  peer.accept({ kind: 'tcp', publicKey: '09'.repeat(32), addresses: [] });
  expect(signal).not.toHaveBeenCalled(); expect(network.listen).not.toHaveBeenCalled();
  peer.close();
  const secret = new Uint8Array(32).fill(7); resolve({ secret, publicKey: '07'.repeat(32) });
  await vi.waitFor(() => expect(secret).toEqual(new Uint8Array(32)));
  expect(random).not.toHaveBeenCalled(); expect(network.listen).not.toHaveBeenCalled();
});

it('reports native initialization failure as an exhausted path without a JS fallback', async () => {
  const exhausted = vi.fn();
  const network: TcpNetwork = { crypto: { keyPair: async () => { throw new Error('unavailable'); },
    channel: vi.fn() }, listen: vi.fn(), connect: vi.fn(), close: vi.fn() };
  new TcpPeer({ sessionId: 'native', desktop: true, config: { servers: [] },
    random: vi.fn(), signal: vi.fn(), channel: vi.fn(), exhausted }, network);
  await vi.waitFor(() => expect(exhausted).toHaveBeenCalledOnce());
  expect(network.close).toHaveBeenCalledOnce(); expect(network.listen).not.toHaveBeenCalled();
});

it('closes native codecs opened after cancellation without writing a late handshake', async () => {
  let resolve!: (result: unknown) => void;
  mocks.invoke.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const socket: TcpSocket = { localAddress: '192.0.2.1', localPort: 40000, bufferedAmount: 0,
    write: vi.fn(), close: vi.fn(), onData: vi.fn(), onClose: vi.fn() };
  const channel = new DesktopTcpChannel({ socket, secret: new Uint8Array(32), publicKey: '09'.repeat(32),
    sessionId: 'native', desktop: true });
  channel.close(); resolve({ id: 'late', output: { writes: [[1, 2]], messages: [], open: false } });
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('remote_chat_tcp_crypto_close', { id: 'late' }));
  expect(socket.write).not.toHaveBeenCalled(); expect(channel.readyState).toBe('closed');
});
