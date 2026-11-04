import http from 'node:http';
import net from 'node:net';
import { expect, it } from 'vitest';
import { TerminalLinkTunnels } from './linkTunnel';
import { LinkSocketFixture } from '../../../../../../shared/terminal/testing/linkSocketFixture';
import type { TerminalLinkRequest } from '../../../../../../shared/terminal/links';
import { LINK_CHUNK_BYTES } from '../../../../../../shared/terminal/linkChunks';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 48 KiB models the old implementation solely as a benchmark reference, not a supported peer protocol.
it.each([48 * 1024, LINK_CHUNK_BYTES])('bounds asset round trips (chunk size %s)', async limit => {
  const remote = new LinkSocketFixture(limit);
  const local = new LinkSocketFixture();
  let reads = 0;
  const client = { link: async (_scope: string, request: TerminalLinkRequest) => {
    if (request.type === 'read') reads++;
    await wait(30);
    const reply = await remote.request(request);
    await wait(30);
    return reply;
  } };
  const tunnel = new TerminalLinkTunnels(client, local.request);
  const content = Buffer.alloc(1536 * 1024, 42);
  const server = http.createServer((_request, response) => response.end(content));
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
    const address = await tunnel.resolve('resource', origin);
    const started = performance.now();
    const received = await new Promise<Buffer>((resolve, reject) => {
      http.get(address, { agent: false }, response => {
        const parts: Buffer[] = [];
        response.on('data', part => parts.push(part));
        response.on('end', () => resolve(Buffer.concat(parts)));
        response.on('error', reject);
      }).on('error', reject);
    });
    const milliseconds = Math.round(performance.now() - started);
    expect(received.equals(content)).toBe(true);
    if (limit === LINK_CHUNK_BYTES) expect(reads).toBeLessThanOrEqual(7);
    else expect(reads).toBeGreaterThanOrEqual(33);
    process.stdout.write(`${JSON.stringify({ scenario: 'single 1.5 MiB asset, 60 ms RPC RTT',
      chunkBytes: limit, reads, milliseconds })}\n`);
  } finally {
    await tunnel.close(); await remote.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 10_000);
