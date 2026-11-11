import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

if (process.argv.includes('--version')) { console.log('0.32.1-port-fixture'); process.exit(0); }
const home = join(process.env.GEMINI_CLI_HOME, 'port-fixture-history');
await mkdir(home, { recursive: true });
const records = async id => JSON.parse(await readFile(join(home, `${id}.json`), 'utf8'));
const save = (id, value) => writeFile(join(home, `${id}.json`), JSON.stringify(value));
const write = value => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`);
const catalog = { models: { currentModelId: 'fixture', availableModels: [{ modelId: 'fixture', name: 'Fixture' }] },
  modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }] } };

// Exercise the environment of the actual child process, including during old-session restoration.
async function bridgeRequest() {
  const response = await fetch(`${process.env.GOOGLE_GEMINI_BASE_URL}/v1beta/models/fixture:countTokens`, {
    method: 'POST', headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY }, body: '{}',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok || !(await response.json()).totalTokens) throw new Error('Bridge environment was not refreshed');
}

function update(sessionId, record) {
  write({ method: 'session/update', params: { sessionId, update: {
    sessionUpdate: `${record.role}_message_chunk`, content: { type: 'text', text: record.text },
  } } });
}

async function handle(frame) {
  const result = value => write({ id: frame.id, result: value });
  if (frame.method === 'initialize') return result({ protocolVersion: 1,
    agentCapabilities: { loadSession: true }, authMethods: [], agentInfo: { name: 'Port recovery fixture', version: '1' } });
  if (frame.method === 'session/new') {
    const sessionId = randomUUID();
    await save(sessionId, []); return result({ sessionId, ...catalog });
  }
  if (frame.method === 'session/load') {
    await bridgeRequest();
    for (const record of await records(frame.params.sessionId)) update(frame.params.sessionId, record);
    return result(catalog);
  }
  if (frame.method === 'session/prompt') {
    await bridgeRequest();
    const sessionId = frame.params.sessionId;
    const text = frame.params.prompt.map(content => content.text ?? '').join('');
    const reply = { role: 'agent', text: `Bridge verified: ${text}` };
    await save(sessionId, [...await records(sessionId), { role: 'user', text }, reply]);
    update(sessionId, reply);
    return result({ stopReason: 'end_turn' });
  }
  if (frame.id !== undefined) result({});
}

createInterface({ input: process.stdin }).on('line', line => {
  const frame = JSON.parse(line);
  void handle(frame).catch(error => write({ id: frame.id, error: { code: -32603, message: error.message } }));
});
