import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createWorker } from './cli-gui-acp-process.mjs';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const root = resolve(desktop, '../../.codex-tmp/cli-gui-accounts');
await mkdir(root, { recursive: true });
const calls = [];
const imageData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const imageUrl = `data:image/png;base64,${imageData}`;
const proxy = createServer(async (request, response) => {
  if (request.headers.authorization !== 'Bearer test-gui-account') { response.writeHead(401).end(); return; }
  if (request.url === '/v1/cli-models') {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ models: [{ slug: 'remoteai-test-model', display_name: 'Internal account model',
      visibility: 'list', default_reasoning_level: 'high', supported_reasoning_levels: [{ effort: 'high', description: 'High' }] }] }));
    return;
  }
  let text = ''; for await (const chunk of request) text += chunk;
  const body = JSON.parse(text); calls.push(body);
  if (request.url !== '/v1/messages') { response.writeHead(404).end(); return; }
  console.log('GUI model request', body.model, body.messages?.length);
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const events = [
    { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model: body.model,
      content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Remote AI account route verified.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } },
    { type: 'message_stop' },
  ];
  for (const event of events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  response.end();
});
await new Promise(resolveListen => proxy.listen(0, '127.0.0.1', resolveListen));
const executable = process.platform === 'win32'
  ? resolve(desktop, 'src-tauri/resources/desktop-service/node.exe') : process.execPath;
const workerOptions = { executable, host: resolve(desktop, 'src-tauri/resources/cli-gui/host.mjs'), root,
  requestTimeoutMs: 90_000, env: { ...process.env,
    REMOTEAI_GUI_PROXY_URL: `http://127.0.0.1:${proxy.address().port}/v1`, REMOTEAI_GUI_PROXY_TOKEN: 'test-gui-account' },
};
let worker = createWorker(workerOptions);
const request = input => worker.request(input);
try {
  for (const engine of ['claude', 'gemini']) {
    let status = await request({ engine, action: 'status' });
    if (status.status !== 'ready') {
      console.log('Installing official CLI:', engine);
      await request({ engine, action: 'install' });
      const deadline = Date.now() + 12 * 60_000;
      do {
        if (Date.now() > deadline) throw new Error('Installation deadline exceeded');
        await delay(3000); status = await request({ engine, action: 'status' });
      } while (status.status === 'installing');
    }
    assert.equal(status.status, 'ready', JSON.stringify(status));
    console.log('Official CLI ready:', engine, status.cliVersion);
    const catalog = await request({ engine, action: 'catalog', cwd: root });
    assert.equal(catalog.status, 'ready', JSON.stringify(catalog));
    assert.equal(catalog.models[0].id, 'remoteai-test-model');
    const session = await request({ engine, action: 'create', cwd: root, model: 'remoteai-test-model', effort: 'high' });
    const before = calls.length;
    const text = '';
    await request({ engine, action: 'send', id: session.id, text,
      messageId: crypto.randomUUID(), images: [imageUrl] });
    let history;
    for (let attempt = 0; attempt < 120; attempt++) {
      history = await request({ engine, action: 'read', id: session.id });
      if (history.entries.some(entry => entry.text.includes('Remote AI account route verified.'))) break;
      if (history.entries.some(entry => entry.role === 'error')) throw new Error(JSON.stringify(history));
      await delay(1000);
    }
    assert.ok(calls.length > before, `${engine} must use the GUI account route`);
    assert.ok(history.entries.some(entry => entry.text.includes('Remote AI account route verified.')), JSON.stringify(history));
    assert.equal(history.session.model, 'remoteai-test-model');
    assert.ok(calls.slice(before).some(call => call.messages?.some(message => Array.isArray(message.content)
      && message.content.some(block => block.type === 'image' && block.source?.media_type === 'image/png'
        && block.source?.data === imageData))), `${engine} must deliver image bytes to the model route`);
    const source = history.entries.find(entry => entry.role === 'user' && entry.images?.length)?.images[0];
    assert.ok(source, `${engine} must retain image history`);
    assert.equal(await request({ engine, action: 'image', id: session.id, source }), imageUrl);
    await request({ engine, action: 'archive', id: session.id });
    await worker.close(); worker = createWorker(workerOptions);
    const restored = await request({ engine, action: 'read', id: session.id });
    const restoredMessage = restored.entries.find(entry => entry.role === 'user' && entry.images?.length);
    assert.equal(restoredMessage?.text, text, `${engine} must preserve image-only and text/image history after restart`);
    assert.equal(await request({ engine, action: 'image', id: session.id, source: restoredMessage.images[0] }), imageUrl);
    console.log('Official CLI + internal account bridge + image bytes + restart history passed:', engine);
  }
} finally {
  await worker.close();
  await new Promise(resolveClose => proxy.close(resolveClose));
}
