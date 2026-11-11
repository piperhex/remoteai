import { afterEach, expect, it, vi } from 'vitest';
import { createServer, Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountBridge } from './bridge';
import { refreshBridgeSessions } from './bridgeSessions';

const cleanup: (() => Promise<unknown>)[] = [];
const upstream = { url: 'http://127.0.0.1:1', token: 'upstream-secret-never-exported' };
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'remoteai-port-restart-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const bridge = new AccountBridge(root, upstream);
  cleanup.push(() => bridge.close());
  await bridge.start();
  return { root, bridge };
}

async function listen(server: Server, port: number) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
}

it('reuses the saved port and credentials with single-flight initialization', async () => {
  const { root, bridge } = await fixture();
  const route = await bridge.route('model', 'high');
  const env = bridge.environment('claude', route);
  await bridge.close();
  const restart = new AccountBridge(root, upstream);
  cleanup.push(() => restart.close());
  const starting = restart.start();
  expect(restart.start()).toBe(starting);
  await starting;
  expect(restart.environment('claude', route)).toEqual(env);
  expect(restart.selection(route)).toEqual({ model: 'model', effort: 'high' });
});

it('moves both restored CLI environments before use without contacting the occupied port', async () => {
  const { root, bridge } = await fixture();
  const route = await bridge.route('model', 'high');
  const agents = join(root, 'paseo/agents');
  await mkdir(join(agents, 'project'), { recursive: true });
  const paths = [join(agents, 'claude.json'), join(agents, 'project/gemini.json')];
  for (const [index, provider] of ['claude', 'gemini'].entries()) {
    await writeFile(paths[index], JSON.stringify({ id: provider, provider,
      labels: { remoteai: 'cli-gui', remoteaiRoute: route }, archivedAt: index ? 'archived' : null,
      persistence: { sessionId: `native-${provider}` }, unknownField: { preserve: true },
      launchEnv: { ...bridge.environment(provider as 'claude' | 'gemini', route), CUSTOM_ENV: 'keep' } }));
  }
  const official = join(agents, 'official.json');
  const unrelated = join(agents, 'unrelated.json');
  const officialRecord = JSON.stringify({ provider: 'claude', labels: { remoteai: 'cli-gui',
    remoteaiClaudeAccount: 'official' }, launchEnv: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' } });
  await writeFile(official, officialRecord);
  await writeFile(unrelated, '{"provider":"gemini","labels":{},"launchEnv":{"KEEP":"yes"}}');
  const oldUrl = bridge.url;
  const token = bridge.environment('claude', route).ANTHROPIC_AUTH_TOKEN;
  await bridge.close();
  const strangerCalls = vi.fn();
  const stranger = createServer((request, response) => { strangerCalls(request.headers); response.end('stranger'); });
  await listen(stranger, Number(new URL(oldUrl).port));
  const restart = new AccountBridge(root, upstream);
  cleanup.push(() => restart.close());
  await restart.start();
  expect(restart.url).not.toBe(oldUrl);
  expect(new URL(restart.url).hostname).toBe('127.0.0.1');
  await refreshBridgeSessions(agents, restart);
  for (const [index, provider] of ['claude', 'gemini'].entries()) {
    const record = JSON.parse(await readFile(paths[index], 'utf8'));
    const env = record.launchEnv;
    expect(record).toMatchObject({ persistence: { sessionId: `native-${provider}` },
      unknownField: { preserve: true }, launchEnv: { CUSTOM_ENV: 'keep' } });
    expect(env).toMatchObject(restart.environment(provider as 'claude' | 'gemini', route));
    const url = provider === 'claude' ? `${env.ANTHROPIC_BASE_URL}/v1/messages/count_tokens`
      : `${env.GOOGLE_GEMINI_BASE_URL}/v1beta/models/fixture:countTokens`;
    const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{}' });
    expect(response.status).toBe(200);
    await response.text();
    const rejected = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer wrong' }, body: '{}' });
    expect(rejected.status).toBe(401);
    await rejected.text();
  }
  expect(strangerCalls).not.toHaveBeenCalled();
  expect(stranger.listening).toBe(true);
  expect(await readFile(official, 'utf8')).toBe(officialRecord);
  expect(await readFile(unrelated, 'utf8')).toBe('{"provider":"gemini","labels":{},"launchEnv":{"KEEP":"yes"}}');
  const persisted = JSON.parse(await readFile(join(root, 'bridge.json'), 'utf8'));
  expect(persisted).toMatchObject({ port: Number(new URL(restart.url).port), token,
    routes: { [route]: { model: 'model', effort: 'high' } } });
  expect(JSON.stringify(persisted)).not.toContain(upstream.token);
  await refreshBridgeSessions(agents, restart);
});

it('recovers stale sessions even when the new port was saved before an interrupted migration', async () => {
  const { root, bridge } = await fixture();
  const route = await bridge.route('model');
  const agents = join(root, 'paseo/agents');
  await mkdir(agents, { recursive: true });
  const file = join(agents, 'old.json');
  await writeFile(file, JSON.stringify({ provider: 'gemini', labels: { remoteai: 'cli-gui', remoteaiRoute: route },
    launchEnv: { ...bridge.environment('gemini', route), GOOGLE_GEMINI_BASE_URL: 'http://127.0.0.1:1/stale' } }));
  await refreshBridgeSessions(agents, bridge);
  expect(JSON.parse(await readFile(file, 'utf8')).launchEnv).toEqual(bridge.environment('gemini', route));
  await writeFile(file, JSON.stringify({ provider: 'gemini', labels: { remoteai: 'cli-gui', remoteaiRoute: 'missing' } }));
  await expect(refreshBridgeSessions(agents, bridge)).rejects.toThrow('accountUnavailable');
});

it('reports non-address errors without port fallback, removes failed listeners and permits retry', async () => {
  const { root, bridge } = await fixture();
  await bridge.close();
  const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  const listening = vi.spyOn(Server.prototype, 'listen').mockImplementationOnce(function (this: Server) {
    process.nextTick(() => this.emit('error', error));
    return this;
  });
  const restart = new AccountBridge(root, upstream);
  cleanup.push(() => restart.close());
  await expect(restart.start()).rejects.toBe(error);
  expect(listening).toHaveBeenCalledTimes(1);
  await restart.start();
  expect(restart.url).toBe(bridge.url);
  expect(listening).toHaveBeenCalledTimes(2);
});

it('releases the newly bound listener when saving the port fails and keeps the old state', async () => {
  const { root, bridge } = await fixture();
  const before = await readFile(join(root, 'bridge.json'), 'utf8');
  await bridge.close();
  await mkdir(join(root, 'bridge.json.tmp'));
  const restart = new AccountBridge(root, upstream);
  cleanup.push(() => restart.close());
  await expect(restart.start()).rejects.toThrow();
  expect(await readFile(join(root, 'bridge.json'), 'utf8')).toBe(before);
  await listen(createServer(), Number(new URL(bridge.url).port));
});

it('reports a failed fallback without another retry and can subsequently bind normally', async () => {
  const { root, bridge } = await fixture();
  await bridge.close();
  const occupied = Object.assign(new Error('occupied'), { code: 'EADDRINUSE' });
  const denied = Object.assign(new Error('denied'), { code: 'EACCES' });
  const listening = vi.spyOn(Server.prototype, 'listen');
  for (const error of [occupied, denied]) {
    listening.mockImplementationOnce(function (this: Server) {
      process.nextTick(() => this.emit('error', error)); return this;
    });
  }
  const restart = new AccountBridge(root, upstream);
  cleanup.push(() => restart.close());
  await expect(restart.start()).rejects.toBe(denied);
  expect(listening).toHaveBeenCalledTimes(2);
  await restart.start();
  expect(restart.url).toBe(bridge.url);
});

it('waits for an in-flight start before closing and leaves its port free', async () => {
  const { root, bridge } = await fixture();
  await bridge.close();
  const restart = new AccountBridge(root, upstream);
  const starting = restart.start();
  await restart.close();
  await starting;
  await listen(createServer(), Number(new URL(restart.url).port));
});
