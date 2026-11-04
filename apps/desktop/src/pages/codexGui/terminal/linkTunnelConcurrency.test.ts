import http from 'node:http';
import net from 'node:net';
import { expect, it } from 'vitest';
import { TerminalLinkTunnels } from './linkTunnel';
import { LinkSocketFixture } from '../../../../../../shared/terminal/testing/linkSocketFixture';
import { StreamBudget } from '../../../../../../shared/port-mapping/streamBudget';
import { ChatRpc } from '../../../../../../shared/remote-chat/rpc';
import type { TerminalLinkReply, TerminalLinkRequest } from '../../../../../../shared/terminal/links';

function remoteClient(peer: LinkSocketFixture) {
  const rpc = new ChatRpc({ prefix: 'mapped-page', event() {}, send: async message => {
    if (message.kind !== 'request') return;
    const body = message.body as { request?: TerminalLinkRequest };
    const data = body.request ? await peer.request(body.request) : 'chat-ready';
    rpc.receive({ kind: 'response', id: message.id, data });
  } });
  return { rpc, client: { link: (_scope: string, request: TerminalLinkRequest) =>
    rpc.request<TerminalLinkReply>('request', { request }) } };
}

function get(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get(url, { agent: false }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks).toString()));
      response.on('error', reject);
    }).on('error', reject);
  });
}

async function serve(server: net.Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
}

it.each([3, 8])('loads 24 resources with %i slots while a persistent stream and chat stay usable', async limit => {
  const remote = new LinkSocketFixture(); const local = new LinkSocketFixture();
  const { rpc, client } = remoteClient(remote);
  const budget = new StreamBudget(limit);
  const tunnel = new TerminalLinkTunnels(client, local.request, { bridgeBudget: budget });
  const server = http.createServer((request, response) => {
    setTimeout(() => response.end(request.url), 15);
  });
  // An upgraded connection stays open throughout resource loading, like Vite's HMR WebSocket.
  server.on('upgrade', (_request, socket) => {
    socket.on('end', () => socket.destroy());
    socket.write('HTTP/1.1 101 Switching Protocols\r\n\r\n');
  });
  let persistent: net.Socket | undefined;
  try {
    const address = await tunnel.resolve('resource', await serve(server));
    persistent = net.connect(Number(new URL(address).port), '127.0.0.1');
    persistent.write('GET /hmr HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    await new Promise<void>(resolve => persistent!.once('data', () => resolve()));
    const resources = Promise.all(Array.from({ length: 24 }, (_, index) => get(`${address}module-${index}`)));
    expect(await rpc.request('request', {})).toBe('chat-ready');
    expect(await resources).toEqual(Array.from({ length: 24 }, (_, index) => `/module-${index}`));
    expect(persistent.destroyed).toBe(false);
    expect(budget.active).toBeLessThanOrEqual(limit);
  } finally {
    persistent?.destroy(); await tunnel.close(); await remote.close(); rpc.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it('cancels a waiting listener on stop and immediately reuses its fixed port', async () => {
  const remote = new LinkSocketFixture(); const local = new LinkSocketFixture();
  const { rpc, client } = remoteClient(remote);
  const budget = new StreamBudget(1);
  const reserved = await budget.acquire(new AbortController().signal);
  const tunnel = new TerminalLinkTunnels(client, local.request, { bridgeBudget: budget });
  const server = http.createServer((_request, response) => response.end('restarted'));
  let next: TerminalLinkTunnels | undefined;
  try {
    const origin = await serve(server);
    const address = await tunnel.resolve('resource', origin);
    const request = get(address).catch(() => 'closed');
    await new Promise(resolve => setTimeout(resolve, 20));
    await tunnel.close();
    expect(await request).toBe('closed');
    reserved!();
    next = new TerminalLinkTunnels(client, new LinkSocketFixture().request,
      { localPort: Number(new URL(address).port), bridgeBudget: budget });
    expect(await get(await next.resolve('resource', origin))).toBe('restarted');
  } finally {
    reserved!(); await tunnel.close(); await next?.close(); await remote.close(); rpc.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
