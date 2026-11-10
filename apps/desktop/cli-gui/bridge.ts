import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { geminiChunks, geminiMessages } from './gemini';
import type { CliModel, ExternalEngine } from '../../../shared/cli-gui/types';

interface Route { model: string; effort?: string }
interface SavedBridge { port: number; token: string; routes: Record<string, Route> }
const BODY_LIMIT = 20 * 1024 * 1024;

/** No upstream credentials leave Rust. CLIs receive only this private loopback credential. */
export class AccountBridge {
  private saved: SavedBridge = { port: 0, token: randomBytes(32).toString('hex'), routes: {} };
  private server = createServer((request, response) => { void this.handle(request, response); });
  private saving: Promise<void> = Promise.resolve();
  constructor(private root: string, private upstream: { url: string; token: string }) {}
  get url() { return `http://127.0.0.1:${this.saved.port}`; }
  selection(id: string) { return Object.hasOwn(this.saved.routes, id) ? this.saved.routes[id] : undefined; }

  async start() {
    await mkdir(this.root, { recursive: true });
    try { this.saved = JSON.parse(await readFile(join(this.root, 'bridge.json'), 'utf8')) as SavedBridge; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.saved.port, '127.0.0.1', () => { this.server.off('error', reject); resolve(); });
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('client.cliGui.connectionFailed');
    this.saved.port = address.port;
    await this.save();
  }
  private save() {
    const data = JSON.stringify(this.saved);
    this.saving = this.saving.catch(() => undefined).then(async () => {
      const temporary = join(this.root, 'bridge.json.tmp');
      await writeFile(temporary, data, { mode: 0o600 });
      await rename(temporary, join(this.root, 'bridge.json'));
    });
    return this.saving;
  }
  async route(model: string, effort?: string) {
    const id = randomUUID();
    this.saved.routes[id] = { model, effort };
    await this.save();
    return id;
  }
  async update(id: string, model: string, effort?: string) {
    if (!Object.hasOwn(this.saved.routes, id)) throw new Error('client.cliGui.invalidRequest');
    this.saved.routes[id] = { model, effort }; await this.save();
  }
  environment(engine: ExternalEngine, id = 'discovery'): Record<string, string> {
    const base = `${this.url}/${id}/${engine}`;
    return engine === 'claude' ? {
      ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: this.saved.token, ANTHROPIC_API_KEY: '',
      CLAUDE_CODE_OAUTH_TOKEN: '', CLAUDE_CODE_USE_BEDROCK: '', CLAUDE_CODE_USE_VERTEX: '',
      CLAUDE_CODE_USE_FOUNDRY: '', CLAUDE_CONFIG_DIR: join(this.root, 'claude'),
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1',
    } : {
      GOOGLE_GEMINI_BASE_URL: base, GEMINI_API_KEY: this.saved.token,
      GEMINI_CLI_HOME: join(this.root, 'gemini'), GOOGLE_GENAI_USE_VERTEXAI: 'false', GOOGLE_GENAI_USE_GCA: 'false',
      GEMINI_CLI_SYSTEM_SETTINGS_PATH: join(this.root, 'gemini-settings.json'),
      GEMINI_CLI_SYSTEM_DEFAULTS_PATH: join(this.root, 'gemini-settings.json'),
    };
  }
  async prepareHomes() {
    await mkdir(join(this.root, 'claude'), { recursive: true });
    await mkdir(join(this.root, 'gemini'), { recursive: true });
    await writeFile(join(this.root, 'gemini-settings.json'), JSON.stringify({
      security: { auth: { selectedType: 'gemini-api-key', enforcedType: 'gemini-api-key' } },
      telemetry: { enabled: false }, privacy: { usageStatisticsEnabled: false },
    }));
  }
  async models(): Promise<CliModel[]> {
    const response = await fetch(`${this.upstream.url}/cli-models`, {
      headers: { authorization: `Bearer ${this.upstream.token}` }, signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error('client.cliGui.accountUnavailable');
    const data = await response.json() as { models?: { slug: string; display_name?: string; visibility?: string;
      default_reasoning_level?: string; supported_reasoning_levels?: { effort: string; description: string }[] }[] };
    return (data.models ?? []).filter(model => model.visibility !== 'hide').map((model, index) => ({
      id: model.slug, label: model.display_name || model.slug, isDefault: index === 0,
      defaultEffort: model.default_reasoning_level ?? '',
      efforts: model.supported_reasoning_levels?.map(level => ({ id: level.effort, label: level.description })),
    }));
  }
  private authorized(request: IncomingMessage, url: URL) {
    const value = request.headers['x-api-key'] ?? request.headers['x-goog-api-key']
      ?? request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('key');
    const actual = Buffer.from(typeof value === 'string' ? value : '');
    const expected = Buffer.from(this.saved.token);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  private async handle(request: IncomingMessage, response: ServerResponse) {
    try {
      const url = new URL(request.url ?? '/', this.url);
      if (!this.authorized(request, url)) { response.writeHead(401).end(); return; }
      const [, id, engine, ...parts] = url.pathname.split('/');
      const route = Object.hasOwn(this.saved.routes, id) ? this.saved.routes[id] : undefined;
      if (!route || !['claude', 'gemini'].includes(engine) || request.method !== 'POST') {
        response.writeHead(404).end(); return;
      }
      const body = await readBody(request);
      const path = parts.join('/');
      if (path.endsWith('count_tokens') || path.endsWith(':countTokens')) {
        const tokens = Math.ceil(JSON.stringify(body).length / 4);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(engine === 'claude' ? { input_tokens: tokens } : { totalTokens: tokens }));
        return;
      }
      if (!(engine === 'claude' && path === 'v1/messages')
        && !(engine === 'gemini' && /models\/.+:(streamGenerateContent|generateContent)$/.test(path))) {
        response.writeHead(404).end(); return;
      }
      await this.forward({ response, body, route, id, gemini: engine === 'gemini', stream: path.endsWith(':streamGenerateContent') });
    } catch (error) {
      console.error('CLI account bridge failed', error instanceof Error ? error.message : 'Unknown failure');
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'client.cliGui.requestFailed' } }));
    }
  }
  private async forward(options: { response: ServerResponse; body: Record<string, unknown>; route: Route;
    id: string; gemini: boolean; stream: boolean }) {
    const { response, route, id, gemini, stream } = options;
    const body = gemini ? geminiMessages(options.body) : options.body;
    body.model = route.model;
    body.metadata = { ...body.metadata as object, remoteai_effort: route.effort };
    const abort = new AbortController();
    response.once('close', () => abort.abort());
    const upstream = await fetch(`${this.upstream.url}/messages`, { method: 'POST', signal: abort.signal,
      headers: { authorization: `Bearer ${this.upstream.token}`, 'content-type': 'application/json', 'session-id': id },
      body: JSON.stringify(body) });
    if (!upstream.body) throw new Error('client.cliGui.requestFailed');
    if (!upstream.ok || !gemini) {
      response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
      await pipeline(Readable.from(upstream.body as unknown as AsyncIterable<Uint8Array>), response); return;
    }
    response.writeHead(200, { 'content-type': stream ? 'text/event-stream' : 'application/json' });
    const parts: unknown[] = [];
    let last: Record<string, unknown> = {};
    for await (const chunk of geminiChunks(upstream.body)) {
      if (stream) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      else {
        const candidate = (chunk.candidates as { content: { parts: unknown[] } }[])[0];
        parts.push(...candidate.content.parts); last = chunk;
      }
    }
    if (!stream) response.write(JSON.stringify({ ...last, candidates: [{ index: 0,
      content: { role: 'model', parts }, finishReason: 'STOP' }] }));
    response.end();
  }
  async close() { this.server.closeAllConnections(); await new Promise<void>(resolve => this.server.close(() => resolve())); }
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new Error('Request too large');
    chunks.push(chunk);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString());
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request');
  return value as Record<string, unknown>;
}
