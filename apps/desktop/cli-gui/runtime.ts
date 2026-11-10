import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { createPaseoClient, type PaseoClient } from '@getpaseo/client';
import { cliVersion } from './version';
import type { CliRuntimeStatus, ExternalEngine } from '../../../shared/cli-gui/types';

export const RUNTIME_VERSION = '0.15.4';
interface Daemon {
  start(): Promise<void>; stop(): Promise<void>;
  getListenTarget(): { type: string; port?: number } | null;
}
// Only the documented server exports cross the dynamic, independently installed runtime boundary.
interface ServerModule {
  loadConfig(home: string, options: { env: NodeJS.ProcessEnv; cli: Record<string, unknown> }): Record<string, unknown>;
  createRootLogger(options: object, context?: object): unknown;
  createPaseoDaemon(config: object, logger: unknown): Promise<Daemon>;
}

export class CliRuntime {
  private installing?: Promise<void>;
  private failure?: string;
  private connecting?: Promise<PaseoClient>;
  private daemon?: Daemon;
  private client?: PaseoClient;
  private versions = new Map<ExternalEngine, { value: string; checkedAt: number }>();
  constructor(readonly root: string, private changed: () => void) {
    // GUI processes may start before a CLI installer updates the login shell's PATH.
    const defaults = process.platform === 'win32'
      ? [join(homedir(), '.local/bin'), join(process.env.APPDATA ?? join(homedir(), 'AppData/Roaming'), 'npm')]
      : [join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'];
    process.env.PATH = [...new Set([dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter),
      ...defaults])].join(delimiter);
  }
  private get installation() { return join(this.root, 'runtime'); }
  private get manifest() { return join(this.installation, 'node_modules/@getpaseo/server/package.json'); }
  private get marker() { return join(this.installation, 'remoteai-ready.json'); }

  async status(engine: ExternalEngine): Promise<CliRuntimeStatus> {
    const installed = await this.installed();
    if (Date.now() - (this.versions.get(engine)?.checkedAt ?? 0) > 30_000) {
      this.versions.set(engine, { checkedAt: Date.now(), value: await cliVersion(engine) });
    }
    return { status: this.installing ? 'installing' : this.failure ? 'error' : installed ? 'ready' : 'missing',
      version: RUNTIME_VERSION, error: this.failure, cliVersion: this.versions.get(engine)?.value || undefined };
  }

  async installed() {
    try { return JSON.parse(await readFile(this.marker, 'utf8')).version === RUNTIME_VERSION
      && JSON.parse(await readFile(this.manifest, 'utf8')).version === RUNTIME_VERSION; }
    catch { return false; }
  }

  install() {
    if (this.installing) return;
    this.failure = undefined;
    this.installing = this.prepare().catch(error => {
      console.error('CLI runtime installation failed', error);
      this.failure = 'client.cliGui.installFailed';
    }).finally(() => { this.installing = undefined; this.changed(); });
  }

  private async prepare() {
    if (await this.installed()) return;
    await mkdir(this.installation, { recursive: true });
    const npm = [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
      join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
      ...(process.env.PATH ?? '').split(delimiter).map(path => join(path, 'node_modules/npm/bin/npm-cli.js')),
    ].find(existsSync);
    if (!npm) throw new Error('Node.js npm installation is unavailable');
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [npm, 'install', '--prefix', this.installation,
        '--no-audit', '--no-fund', '--omit=dev', '--save-exact', `@getpaseo/server@${RUNTIME_VERSION}`],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      child.stderr?.on('data', chunk => process.stderr.write(chunk));
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`npm exited ${code}`)));
    });
    await this.server();
    await writeFile(this.marker, JSON.stringify({ version: RUNTIME_VERSION }));
  }

  async server(): Promise<ServerModule> {
    const manifest = JSON.parse(await readFile(this.manifest, 'utf8')) as { exports: Record<string, { default: string }> };
    const entry = join(dirname(this.manifest), manifest.exports['.'].default);
    return await import(pathToFileURL(entry).href) as ServerModule;
  }

  connect(): Promise<PaseoClient> {
    return this.connecting ??= this.start().catch(error => { this.connecting = undefined; throw error; });
  }

  private async start() {
    if (!await this.installed()) throw new Error('client.cliGui.setupNeeded');
    const home = join(this.root, 'paseo');
    await mkdir(home, { recursive: true });
    // This home belongs exclusively to Remote AI; users' Paseo and CLI configuration stays independent.
    await writeFile(join(home, 'config.json'), JSON.stringify({
      daemon: { listen: '127.0.0.1:0', relay: { enabled: false }, mcp: { enabled: false, injectIntoAgents: false } },
      agents: { providers: { codex: { enabled: false }, copilot: { enabled: false }, opencode: { enabled: false },
        pi: { enabled: false }, omp: { enabled: false }, claude: { enabled: true },
        gemini: { extends: 'acp', command: ['gemini', '--acp'], label: 'Gemini CLI' } } },
      features: { webUi: { enabled: false }, dictation: { enabled: false }, voiceMode: { enabled: false } },
      pluginsEnabled: false,
    }));
    const server = await this.server();
    const password = randomBytes(32).toString('hex');
    const env = { ...process.env, PASEO_HOME: home, PASEO_PASSWORD: password,
      PASEO_DICTATION_ENABLED: 'false', PASEO_VOICE_MODE_ENABLED: 'false' };
    const config = server.loadConfig(home, { env, cli: { listen: '127.0.0.1:0', relayEnabled: false,
      mcpEnabled: false, mcpInjectIntoAgents: false, webUiEnabled: false } });
    const logger = server.createRootLogger({ log: { level: 'warn', file: { path: join(home, 'daemon.log') } } },
      { paseoHome: home });
    this.daemon = await server.createPaseoDaemon(config, logger);
    await this.daemon.start();
    const port = this.daemon.getListenTarget()?.port;
    if (!port) throw new Error('client.cliGui.connectionFailed');
    this.client = createPaseoClient({ url: `ws://127.0.0.1:${port}/ws`, password });
    await this.client.connect();
    return this.client;
  }

  async close() {
    await this.client?.close();
    await this.daemon?.stop();
  }
}
