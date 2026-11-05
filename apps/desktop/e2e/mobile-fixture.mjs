import { testBrowserChannel, testBrowserLaunchOptions } from '../../../scripts/test-browser.mjs';
// Local emulator fixture only. It never connects to a cloud account or an AI provider.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { ChatSessionsFixture } from '../../../shared/testing/chatSessions.mjs';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const session = new ChatSessionsFixture();
const apiPort = Number(process.env.CHAT_TEST_API_PORT ?? 1490);
const uiPort = Number(process.env.CHAT_TEST_UI_PORT ?? 1488);
const profile = { id: 'test-owner', email: 'mobile-test@example.test', role: 'user' };
const devices = [{ deviceId: 'computer', name: '我的工作电脑', platform: 'Windows', online: true,
  localProxyRunning: false, capabilities: [], lastSeenAt: new Date().toISOString() }];
let page;
let blockMobileConnections = false;
let initialRelayIssue = null;
const relayIssueFrame = reason => reason ? { type: 'relay-quota', reason } : { type: 'relay-usage', usage: {
  monthUsedBytes: 0, monthlyLimitBytes: -1, resetAt: '2027-01-01T00:00:00Z',
} };
const previewImage = await readFile(new URL('../src-tauri/icons/32x32.png', import.meta.url));
const httpServer = http.createServer((request, response) => {
  if (request.url === '/test/preview.png') {
    response.setHeader('Content-Type', 'image/png');
    response.end(previewImage);
    return;
  }
  if (request.url?.startsWith('/test/') && !page) {
    response.writeHead(503).end('{}');
    return;
  }
  if (request.url === '/test/composer' && request.method === 'POST') {
    void (async () => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      await page.evaluate((input) => window.chatTest.setComposer(input), JSON.parse(body));
      response.end('{}');
    })().catch(() => response.writeHead(400).end('{}'));
    return;
  }
  if (request.url === '/test/task-review' && request.method === 'POST') {
    void (async () => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      await page.evaluate(input => window.chatTest.setReview(input), JSON.parse(body));
      response.end('{}');
    })().catch(() => response.writeHead(400).end('{}'));
    return;
  }
  if (request.url === '/test/skills' && request.method === 'POST') {
    void (async () => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      await page.evaluate((input) => window.chatTest.setSkills(input), JSON.parse(body));
      response.end('{}');
    })().catch(() => response.writeHead(400).end('{}'));
    return;
  }
  if (request.url === '/test/sidebar' && request.method === 'POST') {
    void (async () => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      await page.evaluate((action) => window.chatTest.setSidebar(action), JSON.parse(body).action);
      response.end('{}');
    })().catch(() => response.writeHead(400).end('{}'));
    return;
  }
  if (request.url === '/test/legacy-history' && request.method === 'POST') {
    void (async () => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      await page.evaluate((enabled) => window.chatTest.setLegacyHistory(enabled), JSON.parse(body).enabled === true);
      response.end('{}');
    })().catch(() => response.writeHead(400).end('{}'));
    return;
  }
  if (['/test/settings-delay', '/test/history-delay', '/test/token-summary-delay'].includes(request.url)
    && request.method === 'POST') {
    void (async () => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      await page.evaluate(({ milliseconds, route }) => {
        if (route === '/test/token-summary-delay') window.chatTest.setTokenSummaryDelay(milliseconds);
        else if (route === '/test/history-delay') window.chatTest.setHistoryDelay(milliseconds);
        else window.chatTest.setSettingsDelay(milliseconds);
      }, {
        milliseconds: JSON.parse(body).milliseconds, route: request.url,
      });
      response.end('{}');
    })().catch(() => response.writeHead(400).end('{}'));
    return;
  }
  if (request.url === '/test/state') {
    void page.evaluate(() => window.chatTest ? ({ ...window.chatTest.demoState(), modes: window.chatTest.modes,
      errors: window.chatTest.errors, desktop: window.desktopTest }) : null).then((state) => {
      if (!state) { response.writeHead(503).end('{}'); return; }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ ...state, connectedMobiles: mobileClients.size, mobileConnections, relayFrames }));
    }).catch((error) => {
      console.error('Could not read local fixture state:', error);
      response.writeHead(503).end('{}');
    });
    return;
  }
  if (request.url === '/test/reset' && request.method === 'POST') {
    blockMobileConnections = false;
    initialRelayIssue = null;
    for (const client of mobileClients) client.terminate();
    relayFrames = 0;
    // The page load event can precede the chat harness's asynchronous initialization.
    void (async () => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      const transportVersion = body ? JSON.parse(body).transportVersion : 1;
      const target = new URL(page.url());
      target.searchParams.set('transportVersion', transportVersion === 2 ? '2' : '1');
      await page.evaluate(() => localStorage.clear());
      await page.goto(target.toString());
    })()
      .then(() => page.waitForFunction(() => Boolean(window.chatTest)))
      .then(() => response.end('{}'))
      .catch(() => response.writeHead(503).end('{}'));
    return;
  }
  if (request.url === '/test/fallback' && request.method === 'POST') {
    void page.evaluate(() => window.chatTest.fallback()).then(() => response.end('{}'))
      .catch(() => response.writeHead(503).end('{}'));
    return;
  }
  if (request.url === '/test/relay-issue' && request.method === 'POST') {
    void (async () => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      const { reason, initial } = JSON.parse(body);
      if (![null, 'unavailable', 'quota'].includes(reason)) throw new Error('Invalid fixture reason');
      if (initial) initialRelayIssue = reason;
      for (const client of mobileClients) client.send(JSON.stringify(relayIssueFrame(reason)));
      response.end('{}');
    })().catch(() => response.writeHead(400).end('{}'));
    return;
  }
  if (request.url === '/test/disconnect' && request.method === 'POST') {
    for (const client of mobileClients) client.close(4000, 'Emulator reconnect test');
    response.end('{}');
    return;
  }
  if (request.url === '/test/connection-block' && request.method === 'POST') {
    void (async () => {
      let body = '';
      for await (const chunk of request) body += chunk.toString();
      blockMobileConnections = JSON.parse(body).blocked === true;
      if (blockMobileConnections) {
        for (const client of mobileClients) client.close(4000, 'Emulator reconnect test');
      }
      response.end('{}');
    })().catch(() => response.writeHead(400).end('{}'));
    return;
  }
  const routes = {
    '/auth/login': { accessToken: 'local-test-token', refreshToken: 'local-test-refresh', user: profile },
    '/auth/refresh': { accessToken: 'renewed-test-token', refreshToken: 'renewed-test-refresh', user: profile },
    '/auth/me': profile,
    '/devices': { devices }, '/devices/providers': { providers: [] },
    '/devices/providers?includeAggregates=true': { providers: [] },
    '/sync/accounts/summary': { accounts: [] },
    '/sync/accounts/web-summary': { accounts: [] },
  };
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(routes[request.url] ?? {}));
});
const wss = new WebSocketServer({ noServer: true });
const mobileClients = new Set();
let mobileConnections = 0;
let relayFrames = 0;
httpServer.on('upgrade', (request, socket, head) => wss.handleUpgrade(request, socket, head,
  (client) => wss.emit('connection', client, request)));
wss.on('connection', (socket, request) => {
  let joined = false;
  socket.on('message', (raw) => {
    const frame = JSON.parse(raw.toString());
    if (request.url === '/device-switch') {
      socket.send(JSON.stringify({ type: 'devices-snapshot', devices }));
      return;
    }
    if (!joined) {
      joined = true;
      if (frame.role === 'mobile') {
        mobileClients.add(socket);
        mobileConnections += 1;
        if (blockMobileConnections) { socket.close(4004, 'Emulator unavailable test'); return; }
        if (initialRelayIssue) socket.send(JSON.stringify(relayIssueFrame(initialRelayIssue)));
      }
      session.join(socket, { role: frame.role, deviceId: 'computer', ownerId: profile.id,
        expiresAt: Date.now() + 3600_000 }, frame, []);
    } else {
      if (frame.type === 'relay') relayFrames += 1;
      // Like the real gateway, reject frames from a closed session without crashing the fixture server.
      try { session.route(socket, frame); }
      catch (error) {
        console.error('Fixture rejected chat frame:', frame.type, error instanceof Error ? error.message : String(error));
        socket.close(4001, 'Chat connection rejected');
      }
    }
  });
  socket.on('close', () => { mobileClients.delete(socket); session.disconnect(socket); });
});
await new Promise((resolve) => httpServer.listen(apiPort, '127.0.0.1', resolve));
const vite = await createServer({ optimizeDeps: { entries: ['e2e/chat-harness.html'] },
  cacheDir: process.env.CHAT_TEST_CACHE, server: { port: uiPort, host: '127.0.0.1' } });
await vite.listen();
const browser = await chromium.launch(testBrowserLaunchOptions({
  channel: testBrowserChannel(process.env.CHAT_TEST_BROWSER), headless: true,
  // The emulator cannot resolve the host browser's .local candidates on its virtual NAT.
  args: process.env.CHAT_TEST_REMOTE_DESKTOP === '1' ? ['--disable-features=WebRtcHideLocalIpsWithMdns'] : [],
}));
page = await browser.newPage();
page.on('pageerror', (error) => console.error(error.message));
page.on('console', (message) => { if (message.type() === 'error') console.error(message.text()); });
page.on('requestfailed', (request) => console.error('Fixture request failed:', request.url(), request.failure()));
const desktopQuery = process.env.CHAT_TEST_REMOTE_DESKTOP === '1' ? '&remote-desktop' : '';
await page.goto(`http://127.0.0.1:${uiPort}/e2e/chat-harness.html?role=desktop&demo${desktopQuery}&socket=ws://127.0.0.1:${apiPort}/device-chat`,
  { timeout: 60_000 });
await page.waitForFunction(() => Boolean(window.chatTest));
console.log(`Mobile fixture ready on port ${apiPort} (local test data only).`);
process.on('SIGINT', async () => {
  await browser.close();
  await vite.close();
  for (const client of wss.clients) client.terminate();
  httpServer.close();
  process.exit(0);
});
