import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CliRuntime } from './runtime';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'remoteai-runtime-restart-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  vi.stubEnv('REMOTEAI_GUI_PROXY_URL', 'http://127.0.0.1:1');
  vi.stubEnv('REMOTEAI_GUI_PROXY_TOKEN', 'test-upstream');
  const runtime = new CliRuntime(root, () => {});
  cleanup.push(() => runtime.close());
  vi.spyOn(runtime, 'installed').mockResolvedValue(true);
  const daemon = { start: vi.fn(async () => { throw new Error('fixture start failed'); }),
    stop: vi.fn(async () => {}), getListenTarget: () => null };
  const server = { loadConfig: () => ({ agentStoragePath: join(root, 'paseo/agents') }),
    createRootLogger: () => ({}), createPaseoDaemon: vi.fn(async () => daemon) };
  vi.spyOn(runtime, 'server').mockResolvedValue(server);
  return { runtime, root, server, daemon };
}

async function assertPortReleased(root: string) {
  const { port } = JSON.parse(await readFile(join(root, 'bridge.json'), 'utf8'));
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise<void>(resolve => server.close(() => resolve()));
}

it('migrates persisted environment before constructing the daemon, and cleans up a failed single-flight start', async () => {
  const { runtime, root, server, daemon } = await fixture();
  const bridge = await runtime.accountBridge();
  const route = await bridge.route('model');
  const agents = join(root, 'paseo/agents');
  await mkdir(agents, { recursive: true });
  const file = join(agents, 'old.json');
  await writeFile(file, JSON.stringify({ provider: 'claude', labels: { remoteai: 'cli-gui', remoteaiRoute: route },
    launchEnv: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:1/stale' } }));
  server.createPaseoDaemon.mockImplementation(async () => {
    expect(JSON.parse(await readFile(file, 'utf8')).launchEnv).toEqual(bridge.environment('claude', route));
    return daemon;
  });
  const connecting = runtime.connect();
  expect(runtime.connect()).toBe(connecting);
  await expect(connecting).rejects.toThrow('fixture start failed');
  expect(daemon.stop).toHaveBeenCalledOnce();
  await assertPortReleased(root);
  await expect(runtime.connect()).rejects.toThrow('fixture start failed');
  expect(server.createPaseoDaemon).toHaveBeenCalledTimes(2);
});

it('does not construct the daemon when old environments cannot be migrated', async () => {
  const { runtime, root, server } = await fixture();
  await mkdir(join(root, 'paseo/agents'), { recursive: true });
  await writeFile(join(root, 'paseo/agents/broken.json'), '{');
  await expect(runtime.connect()).rejects.toThrow();
  expect(server.createPaseoDaemon).not.toHaveBeenCalled();
  await assertPortReleased(root);
});

it('closes the bridge if preparing isolated CLI homes fails, then allows a retry', async () => {
  const { runtime, root } = await fixture();
  await writeFile(join(root, 'claude'), 'blocks mkdir');
  await expect(runtime.accountBridge()).rejects.toThrow();
  await assertPortReleased(root);
  await rm(join(root, 'claude'));
  const bridge = await runtime.accountBridge();
  expect(bridge.url).toContain('127.0.0.1');
});

it('still releases the bridge and reports the startup failure when daemon cleanup also fails', async () => {
  const { runtime, root, daemon } = await fixture();
  daemon.stop.mockRejectedValue(new Error('cleanup failed'));
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  await expect(runtime.connect()).rejects.toThrow('fixture start failed');
  expect(logged).toHaveBeenCalledOnce();
  await assertPortReleased(root);
});
