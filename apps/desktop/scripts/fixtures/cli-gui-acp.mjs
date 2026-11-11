import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv.includes('--version')) { console.log('0.32.1-fixture'); process.exit(0); }
const write = value => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`);
const pending = new Map();
const home = process.env.CLI_FIXTURE_HOME;
if (!home) throw new Error('Fixture home is required');
mkdirSync(home, { recursive: true });
const transcript = sessionId => join(home, `${sessionId}.json`);
const records = sessionId => JSON.parse(readFileSync(transcript(sessionId), 'utf8'));
const append = (sessionId, role, text) => writeFileSync(transcript(sessionId),
  JSON.stringify([...records(sessionId), { role, text }]));
const catalog = { models: { currentModelId: 'fixture', availableModels: [{ modelId: 'fixture', name: 'Fixture' }] },
  modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }] } };
const update = (sessionId, text) => {
  append(sessionId, 'agent', text);
  write({ method: 'session/update', params: { sessionId,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });
};
createInterface({ input: process.stdin }).on('line', line => {
  const frame = JSON.parse(line);
  const result = value => write({ id: frame.id, result: value });
  if (!frame.method) {
    const turn = pending.get(frame.id);
    if (turn) {
      pending.delete(frame.id);
      update(turn.sessionId, frame.result.outcome.optionId === 'allow:once' ? 'Approved fixture response.' : 'Denied.');
      write({ id: turn.id, result: { stopReason: 'end_turn' } });
    }
    return;
  }
  if (frame.method === 'initialize') return result({ protocolVersion: 1,
    agentCapabilities: { loadSession: true }, authMethods: [], agentInfo: { name: 'Remote AI test fixture', version: '1' } });
  if (frame.method === 'session/new') {
    const sessionId = randomUUID(); writeFileSync(transcript(sessionId), '[]'); return result({ sessionId, ...catalog });
  }
  if (frame.method === 'session/load') {
    for (const record of records(frame.params.sessionId)) write({ method: 'session/update',
      params: { sessionId: frame.params.sessionId, update: { sessionUpdate: `${record.role}_message_chunk`,
        content: { type: 'text', text: record.text } } } });
    return result(catalog);
  }
  if (frame.method === 'session/prompt') {
    append(frame.params.sessionId, 'user', frame.params.prompt.map(content => content.text ?? '').join(''));
    const id = `permission-${randomUUID()}`;
    pending.set(id, { id: frame.id, sessionId: frame.params.sessionId });
    update(frame.params.sessionId, 'Checking fixture task. ');
    return write({ id, method: 'session/request_permission', params: { sessionId: frame.params.sessionId,
      toolCall: { toolCallId: 'fixture-write', title: 'Fixture write', kind: 'edit', status: 'pending' },
      options: [{ optionId: 'allow:once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'deny:once', name: 'Deny', kind: 'reject_once' }] } });
  }
  if (frame.method === 'session/cancel') {
    for (const turn of pending.values()) write({ id: turn.id, result: { stopReason: 'cancelled' } });
    pending.clear(); return;
  }
  if (frame.id !== undefined) result({});
});
