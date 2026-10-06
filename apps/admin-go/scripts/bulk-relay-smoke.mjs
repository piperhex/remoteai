import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { Socket } from './parity-devices.mjs';
import { request, fixtureUsers, fixturePassword } from './parity-client.mjs';
import { fixtureDatabase, seedParity } from './seed-parity.mjs';

// Fixed local fixtures only. Exercise real Go sockets, SQL/Redis accounting and the shared E2EE codec.
const base = 'http://127.0.0.1:28081';
const MiB = 1024 * 1024;
const recordPayload = 16384 - 72 - 16;
const sockets = [];
const deviceId = randomUUID();
const compiled = await build({ stdin: { contents:
  "export { BulkCipher } from './shared/remote-chat/bulkCipher.ts';", resolveDir: process.cwd() },
bundle: true, platform: 'node', format: 'esm', write: false });
const { BulkCipher } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text)
  .toString('base64')}`);

class BulkSocket extends Socket {
  constructor(path = '/device-chat') {
    super(base.replace('http:', 'ws:') + path);
    this.receivers = new Map();
    this.failure = null;
    this.wireBytes = 0;
    this.ws.removeAllListeners('message');
    this.ws.on('message', (raw, binary) => {
      try {
        if (!binary) {
          this.frames.push({ body: JSON.parse(raw.toString()), bytes: raw.length });
          this.wake();
          return;
        }
        assert.equal(raw.toString('ascii', 0, 4), 'CSF1');
        const record = raw.subarray(5 + raw[4]);
        const receive = this.receivers.get(record.toString('hex', 8, 24));
        assert.ok(receive, 'unexpected transfer or stale epoch');
        receive(record);
      } catch (error) {
        this.failure = error;
        this.ws.terminate();
      }
    });
    sockets.push(this);
  }

  assertOpen() {
    if (this.failure) throw this.failure;
    assert.equal(this.closed, null, `download connection closed: ${JSON.stringify(this.closed)}`);
  }

  sendBinary(bytes) {
    this.assertOpen();
    this.wireBytes += bytes.length;
    return new Promise((resolve, reject) => this.ws.send(bytes, { binary: true },
      (error) => error ? reject(error) : resolve()));
  }
}

async function verifyLeaseSettlement(expectedBytes) {
  const db = await fixtureDatabase('admin_go');
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const { rows: [row] } = await db.query(`SELECT count(*)::int AS leases,
        coalesce(sum(sent),0)::text AS sent, coalesce(sum(reserved),0)::text AS reserved
        FROM chat_relay_bulk_leases WHERE device_id=$1`, [deviceId]);
      if (row.leases === 0) return; // The legacy per-frame accounting path has no bulk leases.
      if (Number(row.reserved) === 0) {
        assert.equal(Number(row.sent), expectedBytes, 'lease accounting changed the wire-byte billing basis');
        console.log(`PASS bulk lease settlement: ${row.leases} leases, ${row.sent} wire bytes, no reservation left`);
        return;
      }
      await delay(20);
    }
    assert.fail('bulk lease reservations were not settled');
  } finally { await db.end(); }
}

async function waitUntil(predicate, connections) {
  const deadline = performance.now() + 15000;
  while (!predicate()) {
    for (const socket of connections) socket.assertOpen();
    assert.ok(performance.now() < deadline, 'download stopped making progress');
    await delay(2);
  }
}

async function openChat(token, role, extra = {}) {
  const socket = new BulkSocket();
  await socket.send({ type: 'authenticate', role, accessToken: token, deviceId,
    transportVersion: 2, binaryRelay: true, fileBulkV1: true, ...extra });
  assert.equal((await socket.next('chat-policy')).body.fileBulkV1, true);
  return socket;
}

async function openPair(token) {
  const registration = new BulkSocket('/device-switch');
  await registration.send({ type: 'authenticate', accessToken: token, deviceId,
    name: 'Bulk backpressure fixture', platform: 'windows', appVersion: '1.7.6', capabilities: [] });
  await registration.next('authenticated');
  const desktop = await openChat(token, 'desktop');
  await desktop.next('registered');
  const mobile = await openChat(token, 'mobile', { publicKey: 'ab'.repeat(32) });
  const { body: paired } = await mobile.next('paired');
  await desktop.next('peer-open');
  return { desktop, mobile, paired };
}

async function controlRoundTrip(pair) {
  const started = performance.now();
  const frame = { type: 'signal', sessionId: pair.paired.sessionId,
    payload: { kind: 'key', key: 'cd'.repeat(32) } };
  await pair.mobile.send(frame);
  await pair.desktop.next('signal');
  await pair.desktop.send(frame);
  await pair.mobile.next('signal');
  return performance.now() - started;
}

function transferState(pair, size) {
  const context = { sessionId: pair.paired.sessionId, transferId: randomUUID(), epoch: randomUUID(),
    manifestId: randomBytes(32).toString('hex'), desktopKey: 'ab'.repeat(32), clientKey: 'cd'.repeat(32) };
  const root = randomBytes(32);
  return { size, sent: 0, received: 0, sequence: 0, context, requestId: randomUUID(),
    sender: new BulkCipher(root, { ...context, desktop: true }),
    receiver: new BulkCipher(root, { ...context, desktop: false }),
    sourceHash: createHash('sha256'), targetHash: createHash('sha256'), sample: randomBytes(recordPayload) };
}

function encryptedRecord(state) {
  const offset = state.sent % MiB;
  const length = Math.min(recordPayload, MiB - offset, state.size - state.sent);
  const bytes = state.sample.subarray(0, length);
  const record = state.sender.encrypt({ requestId: state.requestId,
    block: Math.floor(state.sent / MiB), offset }, bytes);
  state.sourceHash.update(bytes);
  state.sent += length;
  return Buffer.from(record);
}

async function transfer(pair, options) {
  const state = transferState(pair, options.mib * MiB);
  const transferKey = state.context.transferId.replaceAll('-', '');
  const id = Buffer.from(pair.paired.sessionId);
  const prefix = Buffer.concat([Buffer.from('CSF1'), Buffer.from([id.length]), id]);
  pair.mobile.receivers.set(transferKey, (record) => {
    const { header, bytes } = state.receiver.decrypt(record);
    assert.equal(header.block * MiB + header.offset, state.received, 'missing or reordered data');
    assert.equal(header.sequence, ++state.sequence);
    state.targetHash.update(bytes);
    state.received += bytes.length;
  });
  const started = performance.now();
  try {
    while (state.sent < state.size) {
      await waitUntil(() => state.sent - state.received < 4 * MiB, [pair.desktop, pair.mobile]);
      const batch = [];
      for (let index = 0; index < 16 && state.sent < state.size; index += 1) {
        batch.push(pair.desktop.sendBinary(Buffer.concat([prefix, encryptedRecord(state)])));
      }
      await Promise.all(batch);
    }
    await waitUntil(() => state.received === state.size, [pair.desktop, pair.mobile]);
    assert.equal(state.targetHash.digest('hex'), state.sourceHash.digest('hex'), 'whole-file SHA-256 mismatch');
    const seconds = (performance.now() - started) / 1000;
    console.log(`PASS ${options.label}: ${options.mib} MiB, E2EE and SHA-256, ${seconds.toFixed(2)} s, `
      + `${(options.mib / seconds).toFixed(2)} MiB/s`);
  } finally {
    pair.mobile.receivers.delete(transferKey);
    state.sender.destroy();
    state.receiver.destroy();
  }
}

async function exercise(pair) {
  const latencies = [];
  let probing = true;
  let controlError;
  const controls = (async () => {
    while (probing) {
      latencies.push(await controlRoundTrip(pair));
      await delay(100);
    }
  })().catch((error) => { controlError = error; });
  // Briefly stop the receiving socket repeatedly, long enough for a full sender batch to queue.
  const pauses = setInterval(() => {
    pair.mobile.ws.pause();
    setTimeout(() => pair.mobile.ws.resume(), 60);
  }, 200);
  try {
    const mib = Number(process.env.BULK_SMOKE_MIB || 32);
    assert.ok(Number.isInteger(mib) && mib >= 1 && mib <= 256);
    const results = await Promise.allSettled([transfer(pair, { mib, label: 'slow receiver' }),
      transfer(pair, { mib: 8, label: 'concurrent file' })]);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  } finally {
    clearInterval(pauses);
    pair.mobile.ws.resume();
    probing = false;
    await controls;
  }
  if (controlError) throw controlError;
  assert.ok(Math.max(...latencies) < 1500, 'control traffic stalled behind file data');
  console.log(`PASS control round trips during bulk: ${latencies.length}, max ${Math.max(...latencies).toFixed(0)} ms`);
}

await seedParity();
const login = await request(base, 'POST', '/auth/login', {
  body: { email: fixtureUsers.admin.email, password: fixturePassword },
});
assert.equal(login.status, 201);
const token = login.body.accessToken;
const endpoint = '/admin/api/chat-settings';
const initial = await request(base, 'GET', endpoint, { token });
assert.equal(initial.status, 200);
try {
  const policy = { ...initial.body, fileBulkEnabled: 1, relayMaxMbPerSecond: -1, relayMaxFramesPerSecond: -1 };
  assert.equal((await request(base, 'PATCH', endpoint, { token, body: policy })).status, 200);
  const pair = await openPair(token);
  await exercise(pair);
  pair.mobile.close();
  await pair.mobile.waitClosed();
  pair.mobile = await openChat(token, 'mobile', { resume: {
    sessionId: pair.paired.sessionId, resumeToken: pair.paired.resumeToken,
  } });
  await pair.mobile.next('resumed');
  await transfer(pair, { mib: 4, label: 'new encrypted transfer after reconnect' });
  await verifyLeaseSettlement(pair.desktop.wireBytes);
} finally {
  for (const socket of sockets) socket.ws.terminate();
  assert.equal((await request(base, 'PATCH', endpoint, { token, body: initial.body })).status, 200);
  const db = await fixtureDatabase('admin_go');
  try { await db.query('DELETE FROM remote_devices WHERE "ownerId"=$1 AND "deviceId"=$2',
    [fixtureUsers.admin.id, deviceId]); } finally { await db.end(); }
}
