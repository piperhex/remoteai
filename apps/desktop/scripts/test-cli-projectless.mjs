import { build } from 'esbuild';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

// Usage: Node 22+ test-cli-projectless.mjs <installed cli-gui directory> [claude|gemini] [CLI package directory].
// Only executables are reused; all state and model responses belong to this isolated test.
const installed = process.argv[2];
const engine = process.argv[3] ?? 'claude';
const editSmoke = process.argv.includes('--file-edits');
assert(!editSmoke || engine === 'claude', 'The native edit smoke uses Claude Write and Edit tools');
assert(['claude', 'gemini'].includes(engine), 'Choose claude or gemini');
const cliPackage = engine === 'claude' ? '@anthropic-ai/claude-code' : '@google/gemini-cli';
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
  const original = name === cliPackage && process.argv[4] && !process.argv[4].startsWith('--')
    ? path.resolve(process.argv[4]) : path.join(installed, 'runtime/node_modules', name);
  const target = path.join(root, 'runtime/node_modules', name);
  const value = JSON.parse(await fs.readFile(path.join(original, 'package.json'), 'utf8'));
  await fs.mkdir(target, { recursive: true });
  if (name === '@getpaseo/server') value.exports['.'].default =
    path.relative(target, path.join(original, value.exports['.'].default));
  else {
    const entry = path.join(original, typeof value.bin === 'string' ? value.bin : value.bin[engine]);
    const relative = path.relative(target, entry);
    value.bin = { [engine]: relative };
    if (path.isAbsolute(relative)) {
      // JavaScript launchers support test packages installed on a different Windows volume.
      assert(/\.[cm]?js$/i.test(entry), 'Install native test executables on the temporary directory volume');
      await fs.writeFile(path.join(target, 'smoke.mjs'), `import ${JSON.stringify(pathToFileURL(entry).href)};\n`);
      value.bin = { [engine]: 'smoke.mjs' };
    }
  }
  await fs.writeFile(path.join(target, 'package.json'), JSON.stringify(value));
}

function schemaValue(schema) {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.anyOf || schema.oneOf) return schemaValue((schema.anyOf ?? schema.oneOf)[0]);
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties ?? {})
    .map(([key, value]) => [key, schemaValue(value)]));
  if (schema.type === 'array') return [];
  if (schema.type === 'number' || schema.type === 'integer') return schema.minimum ?? 1;
  if (schema.type === 'boolean') return false;
  return 'A simple greeting';
}

function nextEdit(body) {
  if (!editSmoke || !JSON.stringify(body.messages).includes('Edit the isolated smoke file')) return undefined;
  const results = body.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
    .filter(block => block.type === 'tool_result').map(block => block.tool_use_id);
  if (!results.includes('smoke-write')) return { id: 'smoke-write', name: 'Write',
    input: { file_path: 'review-smoke.txt', content: 'before\n' } };
  if (!results.includes('smoke-edit')) return { id: 'smoke-edit', name: 'Edit',
    input: { file_path: 'review-smoke.txt', old_string: 'before', new_string: 'after\nextra' } };
}

function respond(body, res) {
  assert.equal(body.model, 'smoke-model');
  const schema = body.metadata?.remoteai_output_schema;
  const action = nextEdit(body);
  const text = action ? '' : schema ? JSON.stringify(schemaValue(schema)) : `PROJECTLESS_REPLY_${++replies}`;
  const message = { id: 'msg-smoke', type: 'message', role: 'assistant', model: 'smoke-model', content: [],
    stop_reason: null, stop_sequence: null, usage: { input_tokens: 8, output_tokens: 0 } };
  if (!body.stream) return res.end(JSON.stringify({ ...message, content: [{ type: 'text', text }],
    stop_reason: 'end_turn', usage: { input_tokens: 8, output_tokens: 8 } }));
  res.setHeader('content-type', 'text/event-stream');
  for (const event of [{ type: 'message_start', message },
    { type: 'content_block_start', index: 0, content_block: action
      ? { type: 'tool_use', id: action.id, name: action.name, input: {} } : { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: action
      ? { type: 'input_json_delta', partial_json: JSON.stringify(action.input) } : { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: action ? 'tool_use' : 'end_turn', stop_sequence: null },
      usage: { output_tokens: 8 } },
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
  await service.request({ engine, action: 'send', id: chat.id,
    text: editSmoke ? `Edit the isolated smoke file; turn ${index}.` : `Say hello ${index}. Do not use tools.`,
    messageId: `smoke-${index}` });
  for (let attempt = 0; attempt < 45; attempt++) {
    const history = await service.request({ engine, action: 'read', id: chat.id });
    assert.equal(history.session.cwd, '');
    for (const permission of history.session.permissions) {
      await service.request({ engine, action: 'approve', id: chat.id, permissionId: permission.id,
        actionId: permission.actions.find(action => action.behavior === 'allow').id });
    }
    if (history.entries.some(entry => entry.role === 'assistant' && entry.text.includes(`PROJECTLESS_REPLY_${index}`))) {
      console.log(`Native ${engine} projectless turn ${index} passed`); return;
    }
    await new Promise(done => setTimeout(done, 1000));
  }
  console.error(JSON.stringify(await service.request({ engine, action: 'read', id: chat.id })));
  console.error(await fs.readFile(path.join(root, 'paseo/daemon.log'), 'utf8'));
  throw new Error(`Native ${engine} reply ${index} missing`);
}

try {
  await manifest('@getpaseo/server'); await manifest(cliPackage);
  await fs.copyFile(path.join(installed, 'runtime/remoteai-ready.json'), path.join(root, 'runtime/remoteai-ready.json'));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  process.env.REMOTEAI_GUI_PROXY_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.REMOTEAI_GUI_PROXY_TOKEN = 'isolated-smoke-token';
  const catalog = await service.request({ engine, action: 'catalog' });
  const mode = catalog.defaultMode ?? catalog.modes[0]?.id;
  if (!mode) {
    console.error(await fs.readFile(path.join(root, 'paseo/daemon.log'), 'utf8'));
    throw new Error(`No permission modes: ${JSON.stringify(catalog)}`);
  }
  console.log(`Native ${engine} catalog ready with no selected project`);
  const chat = await service.request({ engine, action: 'create', cwd: '',
    model: 'smoke-model', mode });
  assert.equal(chat.cwd, '');
  await turn(chat, 1); await turn(chat, 2);
  if (editSmoke) {
    const history = await service.request({ engine, action: 'read', id: chat.id });
    const edits = history.entries.filter(entry => entry.changes?.length && entry.status === 'completed');
    assert.equal(edits.length, 2, 'Write and Edit must both survive history projection');
    assert(edits.some(entry => entry.changes.some(change => change.diff.includes('-before')
      && change.diff.includes('+after'))), 'Replacement diff must remain reviewable');
    const workspace = (await fs.readdir(path.join(root, 'workspaces'))).find(name => name.startsWith('chat-'));
    assert.equal(await fs.readFile(path.join(root, 'workspaces', workspace, 'review-smoke.txt'), 'utf8'), 'after\nextra\n');
    console.log('PASS: real Write/Edit changed the file and retained reviewable history');
  }
  assert.equal((await fs.readdir(path.join(root, 'workspaces'))).filter(name => name.startsWith('chat-')).length, 1);
  console.log('PASS: real CLI, isolated model endpoint, preserved projectless session');
} finally {
  await service.close(); server.closeAllConnections();
  await new Promise(done => server.close(done));
  assert.equal(path.dirname(root), os.tmpdir()); await fs.rm(root, { recursive: true, force: true });
}
