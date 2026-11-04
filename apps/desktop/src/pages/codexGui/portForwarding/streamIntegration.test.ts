// @vitest-environment jsdom
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '../../../api/backend';
import { LinkSocketFixture } from '../terminal/linkTunnelSocketFixture';
import { RemoteMappingStreams } from '../../../remoteChat/mappingStreams';
import { BulkCipher } from '../../../../../../shared/remote-chat/bulkCipher';
import { BulkTransport, type BinaryChannel } from '../../../../../../shared/remote-chat/bulkTransport';
import { MappingStreamClient } from '../../../../../../shared/port-mapping/streamClient';
import type { MappingStreamLink } from '../../../../../../shared/port-mapping/streamMux';
import type { TerminalLinkRequest } from '../../../../../../shared/terminal/links';

vi.mock('../../../api/backend', () => ({ invoke: vi.fn() }));
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
afterEach(() => vi.clearAllMocks());

async function fixture(server: net.Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  const sockets = new LinkSocketFixture();
  vi.mocked(invoke).mockImplementation((_name, args) => sockets.request(
    (args as { request: TerminalLinkRequest }).request) as ReturnType<typeof invoke>);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const transports: BulkTransport[] = [];
  const deliver = (side: number, path: 'direct' | 'relay', bytes: Uint8Array) => {
    const timer = setTimeout(() => {
      timers.delete(timer); transports[1 - side].receive(bytes, path);
    }, 30);
    timers.add(timer);
  };
  for (let side = 0; side < 2; side++) {
    const transport = new BulkTransport({ available: () => true, send: async bytes => deliver(side, 'relay', bytes) });
    const channel: BinaryChannel = { readyState: 'open', bufferedAmount: 0,
      send: bytes => deliver(side, 'direct', bytes), close() {}, onLow: () => () => {}, onClose() {},
      onMessage() {} };
    transport.attach(channel); transport.setMode('direct'); transports.push(transport);
  }
  const links: MappingStreamLink[] = transports.map((bulk, side) => ({ bulk, createBulkCipher: identity =>
    new BulkCipher(new Uint8Array(32).fill(37), { ...identity, desktop: side === 1,
      sessionId: 'authenticated-test-session', desktopKey: 'host', clientKey: 'viewer' }) }));
  const host = new RemoteMappingStreams(links[1]);
  let failReceiver = () => {};
  const streams = new MappingStreamClient({ link: () => links[0], random: randomBytes, supported: () => true,
    register: async options => {
      failReceiver = options.failed;
      return { close() {}, unbind() {}, bind: async () => {} };
    },
    request: async <T>(body: object) => {
      await wait(30);
      const result = 'request' in body
        ? await sockets.request(body.request as TerminalLinkRequest)
        : await host.request(body as Record<string, unknown>);
      await wait(30); return result as T;
    } });
  return { origin, streams, failReceiver: () => failReceiver(),
    close: async () => {
      streams.close(); host.close(); transports.forEach(value => value.close());
      timers.forEach(clearTimeout); await sockets.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    } };
}

it('stops real TCP forwarding after receiver failure without silently downgrading', async () => {
  const service = await fixture(net.createServer(socket => socket.pipe(socket)));
  try {
    const first = await service.streams.open('resource', service.origin);
    await first.write(Buffer.from('before'));
    expect(Buffer.from((await first.read()).data).toString()).toBe('before');
    const pending = expect(first.read()).rejects.toThrow('closed');
    service.failReceiver(); await pending;
    await expect(service.streams.open('resource', service.origin)).rejects.toThrow('重新连接');
  } finally { await service.close(); }
});
