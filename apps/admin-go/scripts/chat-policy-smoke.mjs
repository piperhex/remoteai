import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Socket } from './parity-devices.mjs';
import { request, fixtureUsers, fixturePassword } from './parity-client.mjs';
import { fixtureDatabase, seedParity } from './seed-parity.mjs';

// This regression writes only to the fixed local fixture service and restores its policy afterward.
const base = 'http://127.0.0.1:28081';
const endpoint = '/admin/api/chat-settings';
const deviceId = randomUUID();
const sockets = [];
const fields = ['p2pNegotiationTimeoutSeconds', 'p2pRetryIntervalSeconds', 'p2pDisconnectGraceSeconds',
  'relayHeartbeatTimeoutSeconds'];
await seedParity();

async function login(role) {
  const result = await request(base, 'POST', '/auth/login', {
    body: { email: fixtureUsers[role].email, password: fixturePassword },
  });
  assert.equal(result.status, 201);
  return result.body.accessToken;
}

function connect(path = '/device-chat') {
  const socket = new Socket(base.replace('http:', 'ws:') + path);
  sockets.push(socket);
  return socket;
}

function assertCapabilities(message, expected) {
  assert.equal(message.binaryRelay, expected.binaryRelay, 'policy must retain negotiated binary relay support');
  assert.equal(message.fileBulkV1, expected.fileBulkV1, 'policy must retain negotiated bulk download support');
  assert.equal(message.connectionDiagnostics, 1);
}

async function chat(role, accessToken, capabilities = { binaryRelay: true, fileBulkV1: true }) {
  const socket = connect();
  await socket.send({ type: 'authenticate', role, accessToken, deviceId,
    transportVersion: 2, ...capabilities, ...(role === 'mobile' ? { publicKey: 'ab'.repeat(32) } : {}) });
  const { body } = await socket.next('chat-policy');
  assertCapabilities(body, capabilities);
  return { socket, policy: body.policy, capabilities };
}

const token = await login('admin');
const restricted = await login('restricted');
const initial = await request(base, 'GET', endpoint, { token });
assert.equal(initial.status, 200);
for (const field of fields) assert.ok(Number.isSafeInteger(initial.body[field]));
assert.equal((await request(base, 'GET', endpoint)).status, 401);

try {
  const registration = connect('/device-switch');
  await registration.send({ type: 'authenticate', accessToken: token, deviceId,
    name: 'P2P policy fixture', platform: 'windows', appVersion: '1.5.36', capabilities: [] });
  await registration.next('authenticated');
  const desktop = await chat('desktop', token);
  await desktop.socket.next('registered');
  const mobile = await chat('mobile', token);
  await mobile.socket.next('paired');
  const binaryOnly = await chat('mobile', token, { binaryRelay: true, fileBulkV1: false });
  await binaryOnly.socket.next('paired');
  const legacy = await chat('mobile', token, { binaryRelay: false, fileBulkV1: false });
  await legacy.socket.next('paired');
  const peers = [desktop, mobile, binaryOnly, legacy];
  assert.deepEqual(desktop.policy, initial.body);
  assert.deepEqual(mobile.policy, initial.body);
  // Start immediately after the periodic refresh, so a missing save-triggered push cannot pass by coincidence.
  await Promise.all(peers.map(async ({ socket, capabilities }) => {
    const { body } = await socket.next('chat-policy');
    assert.deepEqual(body.policy, initial.body);
    assertCapabilities(body, capabilities);
  }));
  const unauthenticated = connect();
  await unauthenticated.open;
  for (const seconds of [1_000_000, Number.MAX_SAFE_INTEGER]) {
    const policy = { ...initial.body, ...Object.fromEntries(fields.map(field => [field, seconds])) };
    const started = performance.now();
    const response = await request(base, 'PATCH', endpoint, { token, body: policy });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, policy);
    await Promise.all(peers.map(async ({ socket, capabilities }) => {
      const frame = await socket.wait(message => message.type === 'chat-policy'
        && message.policy.p2pNegotiationTimeoutSeconds === seconds, 1500);
      assert.deepEqual(frame.body.policy, policy);
      assertCapabilities(frame.body, capabilities);
    }));
    assert.ok(performance.now() - started < 1500, 'settings must push immediately, before the five-second poll');
    assert.deepEqual((await request(base, 'GET', endpoint, { token })).body, policy);
  }
  assert.equal(unauthenticated.frames.length, 0, 'policy must not be pushed before authentication');
  for (const windowSize of [1, 5, 12]) {
    const current = (await request(base, 'GET', endpoint, { token })).body;
    const policy = { ...current, fileDownloadWindowSize: windowSize };
    assert.equal((await request(base, 'PATCH', endpoint, { token, body: policy })).status, 200);
    await Promise.all(peers.map(async ({ socket, capabilities }) => {
      const frame = await socket.wait(message => message.type === 'chat-policy'
        && message.policy.fileDownloadWindowSize === windowSize
        && message.policy.p2pNegotiationTimeoutSeconds === policy.p2pNegotiationTimeoutSeconds, 1500);
      assert.deepEqual(frame.body.policy, policy);
      assertCapabilities(frame.body, capabilities);
    }));
    assert.deepEqual((await request(base, 'GET', endpoint, { token })).body, policy);
  }
  for (const fileBulkEnabled of [1, 0, 1]) {
    const current = (await request(base, 'GET', endpoint, { token })).body;
    const policy = { ...current, fileBulkEnabled };
    for (const { socket } of peers) {
      socket.frames = socket.frames.filter(({ body }) => body.type !== 'chat-policy');
    }
    assert.equal((await request(base, 'PATCH', endpoint, { token, body: policy })).status, 200);
    await Promise.all(peers.map(async ({ socket, capabilities }) => {
      const frame = await socket.wait(message => message.type === 'chat-policy'
        && message.policy.fileBulkEnabled === fileBulkEnabled, 1500);
      assert.deepEqual(frame.body.policy, policy);
      assertCapabilities(frame.body, capabilities);
    }));
    assert.deepEqual((await request(base, 'GET', endpoint, { token })).body, policy);
  }
  const latest = (await request(base, 'GET', endpoint, { token })).body;
  const reconnected = await chat('mobile', token);
  assert.deepEqual(reconnected.policy, latest);
  assert.equal((await request(base, 'PATCH', endpoint, { token: restricted, body: initial.body })).status, 403);
  for (const field of fields) {
    for (const value of [0, -1, 1.5, null, '45']) {
      assert.equal((await request(base, 'PATCH', endpoint, {
        token, body: { ...latest, [field]: value },
      })).status, 400);
    }
  }
  for (const value of [0, -1, 13, 1.5, null, '5']) {
    assert.equal((await request(base, 'PATCH', endpoint, {
      token, body: { ...latest, fileDownloadWindowSize: value },
    })).status, 400);
  }
  for (const value of [-1, 2, 1.5, null, '1']) {
    assert.equal((await request(base, 'PATCH', endpoint, {
      token, body: { ...latest, fileBulkEnabled: value },
    })).status, 400);
  }
  assert.deepEqual((await request(base, 'GET', endpoint, { token })).body, latest);
  console.log('PASS P2P and relay settings: uncapped values, immediate WS push to both peers, '
    + 'negotiated capabilities across periodic refresh and bulk switch updates, '
    + 'download window, reconnect, permissions and validation');
} finally {
  assert.equal((await request(base, 'PATCH', endpoint, { token, body: initial.body })).status, 200);
  for (const socket of sockets) socket.close();
  const database = await fixtureDatabase('admin_go');
  try { await database.query('DELETE FROM remote_devices WHERE "deviceId" = $1 AND "ownerId" = $2',
    [deviceId, fixtureUsers.admin.id]); }
  finally { await database.end(); }
}
