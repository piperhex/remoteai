import { expect, it } from 'vitest';
import NodeWebSocket, { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import { DeviceStatusConnection } from '../../../../shared/realtime/deviceStatusConnection';

it('real loopback subscription recovers two clients at different times and stops cleanly', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP fixture');
  const records: { id: string; time: number }[] = [];
  const sockets = new Map<string, ServerSocket>();
  let authenticated = 0;
  let opened = 0;
  const waitFor = async (condition: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('Loopback fixture timed out');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  server.on('connection', socket => {
    opened++;
    socket.on('message', raw => {
      const subscription = JSON.parse(raw.toString()) as { type: string; accessToken: string };
      expect(subscription.type).toBe('subscribe-devices');
      records.push({ id: subscription.accessToken, time: performance.now() });
      sockets.set(subscription.accessToken, socket);
      if (records.length === 2) {
        // Both clients see the same outage before the fixture starts acknowledging authentication.
        for (const current of sockets.values()) current.close(1012, 'fixture restart');
      } else if (records.length > 2) socket.send(JSON.stringify({ type: 'devices-snapshot', devices: [] }));
    });
  });
  const clients = [0, 1].map(random => new DeviceStatusConnection({
    url: `ws://127.0.0.1:${address.port}/device-switch`,
    createSocket: url => new NodeWebSocket(url) as unknown as WebSocket,
    subscribe: () => JSON.stringify({ type: 'subscribe-devices', accessToken: `fixture-${random}` }),
    retry: { initialMs: 200, maximumMs: 400, random: () => random },
    message: data => {
      const message = JSON.parse(String(data)) as { type: string };
      if (message.type === 'devices-snapshot') authenticated++;
      return message.type === 'devices-snapshot';
    },
  }));
  try {
    clients.forEach(client => client.start());
    await waitFor(() => authenticated === 2);
    expect(records.slice(2).map(record => record.id)).toEqual(['fixture-0', 'fixture-1']);
    expect(records[3].time - records[2].time).toBeGreaterThan(50);
    expect(opened).toBe(4);
    clients.forEach(client => client.stop());
    await new Promise(resolve => setTimeout(resolve, 450));
    expect(opened).toBe(4);
  } finally {
    clients.forEach(client => client.stop());
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 10_000);
