import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { createPaseoClient, type PaseoClient } from '@getpaseo/client';
import { cliVersion, managedCommand, CLI_PACKAGES } from './version';
import { installPackages } from './npm';
import { AccountBridge } from './bridge';
import type { CliRuntimeStatus, ExternalEngine } from '../../../shared/cli-gui/types';
import type { InstallationProgress } from '../../../shared/cli/installProgressTypes';

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
  private progress?: InstallationProgress;
  private failures = new Map<ExternalEngine, string>();
  private connecting?: Promise<PaseoClient>;
  private daemon?: Daemon;
  private client?: PaseoClient;
  private bridge?: Promise<AccountBridge>;
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
    if (!this.installing && Date.now() - (this.versions.get(engine)?.checkedAt ?? 0) > 30_000) {
      this.versions.set(engine, { checkedAt: Date.now(), value: await cliVersion(engine, this.root) });
    }
    return { status: this.installing ? 'installing' : this.failures.has(engine) ? 'error'
      : installed && this.versions.get(engine)?.value ? 'ready' : 'missing',
      version: RUNTIME_VERSION, error: this.failures.get(engine),
      progress: this.installing ? this.progress : undefined,
      cliVersion: this.versions.get(engine)?.value || undefined };
  }

  async installed() {
    try { return JSON.parse(await readFile(this.marker, 'utf8')).version === RUNTIME_VERSION
      && JSON.parse(await readFile(this.manifest, 'utf8')).version === RUNTIME_VERSION; }
    catch { return false; }
  }

  install(engine: ExternalEngine) {
    if (this.installing) return;
    this.failures.delete(engine);
    this.progress = { phase: 'preparing', downloaded: 0 };
    this.installing = this.prepare(engine).catch(error => {
      console.error('CLI runtime installation failed', error);
      this.failures.set(engine, 'client.cliGui.installFailed');
    }).finally(() => { this.installing = undefined; this.progress = undefined;
      this.versions.delete(engine); this.changed(); });
    this.changed();
  }

  private async prepare(engine: ExternalEngine) {
    await mkdir(this.installation, { recursive: true });
    await this.close();
    await installPackages(this.root, [`@getpaseo/server@${RUNTIME_VERSION}`, `${CLI_PACKAGES[engine]}@latest`], progress => {
      this.progress = progress; this.changed();
    });
    this.progress = { ...this.progress, phase: 'verifying', downloaded: this.progress?.downloaded ?? 0 };
    this.changed();
    if (!await cliVersion(engine, this.root)) throw new Error('CLI installation did not pass its version check');
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

  accountBridge(): Promise<AccountBridge> {
    return this.bridge ??= (async () => {
      const url = process.env.REMOTEAI_GUI_PROXY_URL;
      const token = process.env.REMOTEAI_GUI_PROXY_TOKEN;
      if (!url || !token) throw new Error('client.cliGui.accountUnavailable');
      const bridge = new AccountBridge(this.root, { url, token });
      await bridge.start(); await bridge.prepareHomes(); return bridge;
    })().catch(error => { this.bridge = undefined; throw error; });
  }

  private async start() {
    if (!await this.installed()) throw new Error('client.cliGui.setupNeeded');
    const home = join(this.root, 'paseo');
    await mkdir(home, { recursive: true });
    const bridge = await this.accountBridge();
    const claudeCommand = await managedCommand(this.root, 'claude');
    const geminiCommand = await managedCommand(this.root, 'gemini') ?? ['gemini'];
    // This home belongs exclusively to Remote AI; users' Paseo and CLI configuration stays independent.
    await writeFile(join(home, 'config.json'), JSON.stringify({
      daemon: { listen: '127.0.0.1:0', relay: { enabled: false }, mcp: { enabled: false, injectIntoAgents: false } },
      agents: { providers: { codex: { enabled: false }, copilot: { enabled: false }, opencode: { enabled: false },
        pi: { enabled: false }, omp: { enabled: false }, claude: { enabled: true,
          ...(claudeCommand ? { command: claudeCommand } : {}), env: bridge.environment('claude') },
        gemini: { extends: 'acp', command: [...geminiCommand, '--acp'], label: 'Gemini CLI',
          env: bridge.environment('gemini') } } },
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
    if (this.bridge) await (await this.bridge).close();
    this.bridge = undefined; this.connecting = undefined; this.client = undefined; this.daemon = undefined;
  }
}
