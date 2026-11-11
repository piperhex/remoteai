import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountBridge } from './bridge';
import { geminiMessages, GeminiStream } from './gemini';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

it('routes both CLI protocols through GUI credentials and preserves the chosen model after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'remoteai-cli-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const calls: { body: Record<string, unknown>; auth: string | undefined; session: string | string[] | undefined }[] = [];
  const upstream = createServer(async (request, response) => {
    let data = ''; for await (const chunk of request) data += chunk;
    calls.push({ body: JSON.parse(data), auth: request.headers.authorization, session: request.headers['session-id'] });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const event of [
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'from internal account' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
    ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
    response.end();
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => upstream.close(() => resolve())));
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('Missing listener');
  const target = { url: `http://127.0.0.1:${address.port}`, token: 'gui-only-credential' };
  let bridge = new AccountBridge(root, target);
  cleanup.push(() => bridge.close());
  await bridge.start();
  const route = await bridge.route('internal-model', 'high');
  const claude = bridge.environment('claude', route);
  expect(Object.values(claude)).not.toContain(target.token);
  const wrong = await fetch(`${claude.ANTHROPIC_BASE_URL}/v1/messages`, { method: 'POST',
    headers: { authorization: 'Bearer wrong' }, body: '{}' });
  expect(wrong.status).toBe(401); expect(calls).toHaveLength(0);
  const result = await fetch(`${claude.ANTHROPIC_BASE_URL}/v1/messages`, { method: 'POST',
    headers: { authorization: `Bearer ${claude.ANTHROPIC_AUTH_TOKEN}` },
    body: JSON.stringify({ model: 'claude-native-alias', stream: true, messages: [{ role: 'user', content: 'hello' }] }) });
  expect(await result.text()).toContain('from internal account');
  expect(calls[0]).toMatchObject({ auth: 'Bearer gui-only-credential', session: route,
    body: { model: 'internal-model', metadata: { remoteai_effort: 'high' } } });
  const url = bridge.url;
  await bridge.close(); bridge = new AccountBridge(root, target); await bridge.start();
  expect(bridge.url).toBe(url);
  await bridge.update(route, 'third-party-model', 'medium');
  const gemini = bridge.environment('gemini', route);
  const response = await fetch(`${gemini.GOOGLE_GEMINI_BASE_URL}/v1beta/models/gemini-native:streamGenerateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': gemini.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      generationConfig: { temperature: 1, maxOutputTokens: 16384 } }),
  });
  const stream = await response.text();
  expect(stream).toContain('from internal account');
  expect(stream).toContain('finishReason');
  expect(calls[1].body).toMatchObject({ model: 'third-party-model', temperature: 1, max_tokens: 16384,
    metadata: { remoteai_effort: 'medium' } });
  const persisted = await readFile(join(root, 'bridge.json'), 'utf8');
  expect(persisted).not.toContain(target.token);
});

it('preserves same-name tool calls, results and schema types in Gemini transcripts', () => {
  const body = geminiMessages({ contents: [
    { role: 'model', parts: [
      { functionCall: { id: 'a', name: 'read', args: { path: 'a.ts' } } },
      { functionCall: { id: 'b', name: 'read', args: { path: 'b.ts' } } },
    ] },
    { role: 'user', parts: [
      { functionResponse: { name: 'read', response: { output: 'A' } } },
      { functionResponse: { name: 'read', response: { output: 'B' } } },
    ] },
  ], tools: [{ functionDeclarations: [{ name: 'read', parameters: { type: 'OBJECT',
    properties: { path: { type: 'STRING' } } } }] }] });
  expect(body).toMatchObject({ messages: [
    { role: 'assistant', content: [{ id: 'a' }, { id: 'b' }] },
    { role: 'user', content: [{ tool_use_id: 'a' }, { tool_use_id: 'b' }] },
  ], tools: [{ input_schema: { type: 'object', properties: { path: { type: 'string' } } } }] });
});

it('streams tool arguments only after completion and reports actual usage', () => {
  const stream = new GeminiStream();
  stream.convert({ type: 'message_start', message: { usage: { input_tokens: 12 } } });
  stream.convert({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'read' } });
  expect(stream.convert({ type: 'content_block_delta', index: 1,
    delta: { type: 'input_json_delta', partial_json: '{"path":' } })).toBeUndefined();
  stream.convert({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"file"}' } });
  expect(stream.convert({ type: 'content_block_stop', index: 1 })).toMatchObject({ candidates: [{
    content: { parts: [{ functionCall: { id: 't1', name: 'read', args: { path: 'file' } } }] },
  }] });
  expect(stream.convert({ type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 8 } }))
    .toMatchObject({ candidates: [{ finishReason: 'MAX_TOKENS' }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 } });
});

it('preserves structured-output requests used by Gemini routing and planning', () => {
  expect(geminiMessages({ contents: [], generationConfig: { responseMimeType: 'application/json',
    responseSchema: { type: 'OBJECT', properties: { route: { type: 'STRING' } } } } }))
    .toMatchObject({ metadata: { remoteai_json_output: true, remoteai_output_schema: {
      type: 'object', properties: { route: { type: 'string' } },
    } } });
});
