import { expect, test } from '@playwright/test';
import { WebSocketServer, WebSocket } from 'ws';
import type {} from './file-connection-harness';

for (const direct of [true, false]) {
  test(`independent ${direct ? 'P2P' : 'Relay'} files keep chat alive`, async ({ page }) => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (typeof address === 'string') throw new Error('Unexpected address');
    const peers = new Map<string, WebSocket>();
    let records = 0;
    server.on('connection', (socket, request) => {
      expect(request.url).toBe('/device-chat?channel=file');
      let side = '', sessionId = '';
      socket.on('message', (data, binary) => {
        if (!side) {
          const auth = JSON.parse(data.toString());
          expect(auth.type).toBe('file-relay-authenticate');
          expect(auth.accessToken).toBeUndefined();
          side = auth.ticket; sessionId = auth.sessionId; peers.set(side, socket);
          socket.send(JSON.stringify({ type: 'file-relay-ready', sessionId, fileBulkV1: true })); return;
        }
        expect(binary).toBe(true); records++;
        peers.get(side === 'host' ? 'viewer' : 'host')!.send(data, { binary: true });
      });
    });
    try {
      await page.goto('/e2e/file-connection-harness.html');
      await page.waitForFunction(() => !!window.exerciseFileConnections);
      const result = await page.evaluate(({ url, direct }) => window.exerciseFileConnections(url, direct),
        { url: `ws://127.0.0.1:${address.port}/device-chat`, direct });
      expect(result.bytes).toBe(4 * 64 * 16_000);
      expect(result.errors).toEqual([]); expect(result.failed).toEqual([]);
      expect(result.chat).toBeGreaterThanOrEqual(16);
      expect(records).toBe(direct ? 0 : 256);
      if (direct) expect(result.peers).toBe(2);
    } finally {
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
}
