import { build } from 'esbuild';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

// Usage: Node 22+ test-cli-projectless.mjs <installed Remote AI cli-gui directory>.
// Only executables are reused; all state and model responses belong to this isolated test.
const installed = process.argv[2];
assert(installed && path.isAbsolute(installed), 'Pass the installed cli-gui directory');
assert(Number(process.versions.node.split('.')[0]) >= 22, 'Use Node.js 22 or newer');
const project = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(project, '.codex-tmp/cli-projectless-smoke/service.mjs');
await build({ stdin: { contents: `export { CliService } from './apps/desktop/cli-gui/service';
  export { CliRuntime } from './apps/desktop/cli-gui/runtime';`, resolveDir: project, loader: 'ts' },
  outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
const { CliService, CliRuntime } = await import(pathToFileURL(output).href);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteai-projectless-smoke-'));
let replies = 0;

async function manifest(name) {
  const original = path.join(installed, 'runtime/node_modules', name);
  const target = path.join(root, 'runtime/node_modules', name);
  const value = JSON.parse(await fs.readFile(path.join(original, 'package.json'), 'utf8'));
  if (name === '@getpaseo/server') value.exports['.'].default =
    path.relative(target, path.join(original, value.exports['.'].default));
  else value.bin.claude = path.relative(target, path.join(original, value.bin.claude));
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, 'package.json'), JSON.stringify(value));
}

function respond(body, res) {
  assert.equal(body.model, 'smoke-model');
  const text = `PROJECTLESS_REPLY_${++replies}`;
  const message = { id: 'msg-smoke', type: 'message', role: 'assistant', model: 'smoke-model', content: [],
    stop_reason: null, stop_sequence: null, usage: { input_tokens: 8, output_tokens: 0 } };
  if (!body.stream) return res.end(JSON.stringify({ ...message, content: [{ type: 'text', text }],
    stop_reason: 'end_turn', usage: { input_tokens: 8, output_tokens: 8 } }));
  res.setHeader('content-type', 'text/event-stream');
  for (const event of [{ type: 'message_start', message },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } },
    { type: 'message_stop' }]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  res.end();
}

const server = createServer(async (req, res) => {
  try {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/cli-models') return res.end(JSON.stringify({ models: [{
      slug: 'smoke-model', display_name: 'Smoke model',
    }] }));
    if (req.url !== '/messages') { res.writeHead(404).end(); return; }
    const parts = []; for await (const chunk of req) parts.push(chunk);
    respond(JSON.parse(Buffer.concat(parts).toString()), res);
  } catch (error) { console.error(error.message); res.writeHead(500).end(); }
});
const service = new CliService(new CliRuntime(root, () => {}), () => {});
async function turn(chat, index) {
  await service.request({ engine: 'claude', action: 'send', id: chat.id,
    text: `Say hello ${index}. Do not use tools.`, messageId: `smoke-${index}` });
  for (let attempt = 0; attempt < 45; attempt++) {
    const history = await service.request({ engine: 'claude', action: 'read', id: chat.id });
    assert.equal(history.session.cwd, '');
    if (history.entries.some(entry => entry.role === 'assistant' && entry.text.includes(`PROJECTLESS_REPLY_${index}`))) {
      console.log(`Native Claude projectless turn ${index} passed`); return;
    }
    await new Promise(done => setTimeout(done, 1000));
  }
  throw new Error(`Native Claude reply ${index} missing`);
}

try {
  await manifest('@getpaseo/server'); await manifest('@anthropic-ai/claude-code');
  await fs.copyFile(path.join(installed, 'runtime/remoteai-ready.json'), path.join(root, 'runtime/remoteai-ready.json'));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  process.env.REMOTEAI_GUI_PROXY_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.REMOTEAI_GUI_PROXY_TOKEN = 'isolated-smoke-token';
  const catalog = await service.request({ engine: 'claude', action: 'catalog' });
  assert(catalog.modes.some(mode => mode.id === 'default'));
  console.log('Native Claude catalog ready with no selected project');
  const chat = await service.request({ engine: 'claude', action: 'create', cwd: '',
    model: 'smoke-model', mode: 'default' });
  assert.equal(chat.cwd, '');
  await turn(chat, 1); await turn(chat, 2);
  assert.equal((await fs.readdir(path.join(root, 'workspaces'))).filter(name => name.startsWith('chat-')).length, 1);
  console.log('PASS: real CLI, isolated model endpoint, preserved projectless session');
} finally {
  await service.close(); server.closeAllConnections();
  await new Promise(done => server.close(done));
  assert.equal(path.dirname(root), os.tmpdir()); await fs.rm(root, { recursive: true, force: true });
}
