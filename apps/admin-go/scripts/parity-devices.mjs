import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createPair, fixturePassword, request } from './parity-client.mjs';
import { fixtureDatabase } from './seed-parity.mjs';

const require = createRequire(new URL('../testdata/tools/package.json', import.meta.url));
const WebSocket = require('ws');
const bcrypt = require('bcryptjs');
const deviceUser = '00000000-0000-4000-8000-000000000011';
const deviceID = '00000000-0000-4000-8000-000000000012';
const deviceEmail = 'devices-fixture@example.test';
const sides = ['legacy', 'modern'];

export class Socket {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.frames = [];
    this.waiters = [];
    this.closed = null;
    this.open = new Promise((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', reject); });
    this.ws.on('message', (raw) => { this.frames.push({ body: JSON.parse(raw.toString()), bytes: raw.length }); this.wake(); });
    this.ws.on('close', (code, reason) => { this.closed = { code, reason: reason.toString() }; this.wake(); });
  }
  wake() { for (const callback of [...this.waiters]) callback(); }
  async send(message) { await this.open; this.ws.send(JSON.stringify(message)); }
  wait(predicate, timeout = 6000) {
    return new Promise((resolve, reject) => {
      const done = (error, value) => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((callback) => callback !== poll);
        if (error) reject(error); else resolve(value);
      };
      const poll = () => {
        const index = this.frames.findIndex(({ body }) => predicate(body));
        if (index >= 0) return done(null, this.frames.splice(index, 1)[0]);
        if (this.closed) done(new Error(`Socket closed ${JSON.stringify(this.closed)}`));
      };
      const timer = setTimeout(() => done(new Error('Timed out waiting for WebSocket frame')), timeout);
      this.waiters.push(poll);
      poll();
    });
  }
  next(type) { return this.wait((message) => message.type === type); }
  waitClosed(timeout = 6000) {
    if (this.closed) return Promise.resolve(this.closed);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for close')), timeout);
      this.ws.once('close', () => { clearTimeout(timer); resolve(this.closed); });
    });
  }
  close() { this.ws.close(); }
}

async function seedDevices() {
  const hash = await bcrypt.hash(fixturePassword, 12);
  for (const database of ['legacy', 'admin_go']) {
    const db = await fixtureDatabase(database);
    try {
      await db.query(`INSERT INTO users (id,email,"passwordHash",role,disabled) VALUES($1,$2,$3,'user',false)
        ON CONFLICT(id) DO UPDATE SET "passwordHash"=EXCLUDED."passwordHash",role='user',disabled=false`,
      [deviceUser, deviceEmail, hash]);
      for (const table of ['remote_devices', 'synced_accounts', 'synced_providers']) {
        await db.query(`DELETE FROM ${table} WHERE "ownerId"=$1`, [deviceUser]);
      }
    } finally { await db.end(); }
  }
}

function connect(pair, side, path) { return new Socket(pair.urls[side].replace(/^http/, 'ws') + path); }
function checkedFrames(pair, label, frames, normalize) {
  if (frames.modern.body.type === 'chat-policy') {
    const { connectionDiagnostics, authRenewal, ...legacyFields } = frames.modern.body;
    assert.equal(connectionDiagnostics, 1, 'Go must advertise the supported diagnostic protocol');
    assert.equal(authRenewal, true, 'Go must advertise in-place authentication renewal');
    // Frozen Nest lacks these capabilities; verify Go extensions before comparing the shared policy.
    frames = { ...frames, modern: { ...frames.modern, body: legacyFields } };
  }
  if (frames.modern.body.type === 'peer-open' && frames.modern.body.expiresAt !== undefined) {
    const { expiresAt, ...legacyFields } = frames.modern.body;
    assert.ok(Number.isSafeInteger(expiresAt) && expiresAt > Date.now() && expiresAt <= Date.now() + 3600_000,
      'Go desktop grant must have a bounded authentication expiry');
    frames = { ...frames, modern: { ...frames.modern, body: legacyFields } };
  }
  return pair.check(label, Object.fromEntries(sides.map((side) => [side, { status: 200, body: frames[side].body }])), normalize);
}
async function bothNext(sockets, type) {
  return Object.fromEntries(await Promise.all(sides.map(async (side) => [side, await sockets[side].next(type)])));
}

async function authenticateDevices(pair) {
  const devices = {};
  const subscribers = {};
  for (const side of sides) {
    subscribers[side] = connect(pair, side, '/device-switch');
    await subscribers[side].send({ type: 'subscribe-devices', accessToken: pair.tokens[side] });
    await subscribers[side].next('devices-snapshot');
    devices[side] = connect(pair, side, '/device-switch');
    await devices[side].send({ type: 'authenticate', accessToken: pair.tokens[side], deviceId: deviceID,
      name: ' Simulated PC ', platform: 'windows', appVersion: '1.5.34', localProxyRunning: true,
      capabilities: ['provider-switch', 'provider-group-switch', 'restart-codex', 'unknown', 'provider-switch'] });
  }
  checkedFrames(pair, 'device WebSocket authentication', await bothNext(devices, 'authenticated'));
  checkedFrames(pair, 'subscriber device online notification', await bothNext(subscribers, 'device-online'));
  return { devices, subscribers };
}

async function command(pair, sockets, options) {
  const pending = pair.request('POST', `/devices/${deviceID}/${options.path}`, { body: options.body });
  for (const side of sides) {
    const { body } = await sockets[side].next(options.type);
    assert.match(body.commandId, /^[0-9a-f-]{36}$/);
    for (const [key, value] of Object.entries(options.body ?? {})) assert.equal(body[key], value);
    await sockets[side].send({ type: 'switch-result', commandId: body.commandId,
      success: !options.fail, ...(options.fail ? { error: 'Simulated desktop rejection' } : {}) });
  }
  const responses = await pending;
  for (const side of sides) assert.equal(responses[side].status, options.fail ? 409 : 201);
  pair.check(`remote ${options.path}${options.fail ? ' failure' : ''}`, responses);
}

async function chatConnection(pair, options) {
  const sockets = {};
  for (const side of sides) {
    sockets[side] = connect(pair, side, '/device-chat');
    await sockets[side].send({ type: 'authenticate', accessToken: pair.tokens[side], deviceId: deviceID,
      role: options.role, transportVersion: options.version ?? 2, ...options.message?.(side) });
  }
  checkedFrames(pair, `chat ${options.role} policy`, await bothNext(sockets, 'chat-policy'));
  return sockets;
}

async function exerciseHotChat(pair, allSockets) {
  const desktops = await chatConnection(pair, { role: 'desktop' });
  allSockets.push(...Object.values(desktops));
  checkedFrames(pair, 'chat desktop registered', await bothNext(desktops, 'registered'));
  const mobiles = await chatConnection(pair, { role: 'mobile', message: () => ({ publicKey: 'ab'.repeat(32) }) });
  allSockets.push(...Object.values(mobiles));
  const paired = await bothNext(mobiles, 'paired');
  pair.alias(paired.legacy.body.resumeToken, paired.modern.body.resumeToken, 'resume proof');
  checkedFrames(pair, 'chat v2 paired', paired, (body) => ({ ...body, expiresAt: '<expiry>' }));
  checkedFrames(pair, 'chat desktop peer open', await bothNext(desktops, 'peer-open'),
    (body) => ({ ...body, expiresAt: '<expiry>' }));
  for (const side of sides) {
    assert.ok(paired[side].body.expiresAt > Date.now());
    await mobiles[side].send({ type: 'signal', sessionId: paired[side].body.sessionId,
      payload: { kind: 'key', key: 'cd'.repeat(32), ignored: 'must not be forwarded', generation: 7 } });
  }
  const signalled = await bothNext(desktops, 'signal');
  for (const side of sides) assert.deepEqual(signalled[side].body.payload, { kind: 'key', key: 'cd'.repeat(32) });
  checkedFrames(pair, 'chat key signalling', signalled);
  for (const side of sides) await mobiles[side].send({ type: 'relay', sessionId: paired[side].body.sessionId, payload: '01abff' });
  checkedFrames(pair, 'encrypted v2 relay', await bothNext(desktops, 'relay'));
  for (const socket of Object.values(mobiles)) socket.close();
  await Promise.all(Object.values(mobiles).map((socket) => socket.waitClosed()));
  checkedFrames(pair, 'chat peer offline', await bothNext(desktops, 'peer-offline'));
  const resumed = await chatConnection(pair, { role: 'mobile', message: (side) => ({ resume: {
    sessionId: paired[side].body.sessionId, resumeToken: paired[side].body.resumeToken,
  } }) });
  allSockets.push(...Object.values(resumed));
  checkedFrames(pair, 'chat mobile session resumed', await bothNext(resumed, 'resumed'), (body) => ({ ...body, expiresAt: '<expiry>' }));
  checkedFrames(pair, 'chat desktop session resumed', await bothNext(desktops, 'resumed'), (body) => ({ ...body, expiresAt: '<expiry>' }));
  for (const side of sides) await resumed[side].send({ type: 'peer-close', sessionId: paired[side].body.sessionId });
  checkedFrames(pair, 'chat mobile peer close', await bothNext(resumed, 'peer-close'));
  checkedFrames(pair, 'chat desktop peer close', await bothNext(desktops, 'peer-close'));
  for (const side of sides) await desktops[side].send({ type: 'relay', sessionId: paired[side].body.sessionId, payload: 'aa' });
  for (const socket of [...Object.values(desktops), ...Object.values(resumed)]) socket.close();
  await Promise.all([...Object.values(desktops), ...Object.values(resumed)].map((socket) => socket.waitClosed()));
}

async function exerciseLegacyChat(pair, allSockets) {
  const desktops = await chatConnection(pair, { role: 'desktop', version: 1 });
  allSockets.push(...Object.values(desktops));
  await bothNext(desktops, 'registered');
  const mobiles = await chatConnection(pair, { role: 'mobile', version: 1, message: () => ({ publicKey: 'ab'.repeat(32) }) });
  allSockets.push(...Object.values(mobiles));
  const paired = await bothNext(mobiles, 'paired');
  checkedFrames(pair, 'legacy chat paired with direct timeout', paired);
  checkedFrames(pair, 'legacy chat peer open', await bothNext(desktops, 'peer-open'));
  for (const side of sides) await mobiles[side].send({ type: 'relay-request', sessionId: paired[side].body.sessionId, reason: 'disconnected' });
  checkedFrames(pair, 'legacy mobile relay ready', await bothNext(mobiles, 'relay-ready'));
  checkedFrames(pair, 'legacy desktop relay ready', await bothNext(desktops, 'relay-ready'));
  for (const side of sides) await desktops[side].send({ type: 'relay', sessionId: paired[side].body.sessionId, payload: 'abcd' });
  checkedFrames(pair, 'legacy encrypted relay', await bothNext(mobiles, 'relay'));
  for (const socket of [...Object.values(desktops), ...Object.values(mobiles)]) socket.close();
  await Promise.all([...Object.values(desktops), ...Object.values(mobiles)].map((socket) => socket.waitClosed()));
}

export async function runDevices(pair = null) {
  await seedDevices();
  pair ??= await createPair();
  const allSockets = [];
  for (const side of sides) {
    const login = await request(pair.urls[side], 'POST', '/auth/login', { body: { email: deviceEmail, password: fixturePassword } });
    assert.equal(login.status, 201);
    pair.tokens[side] = login.body.accessToken;
  }
  try {
    await pair.step('empty owned devices', 'GET', '/devices');
    const account = await pair.step('device fixture account', 'PUT', '/sync/accounts', { body: { accounts: [{ id: 'device-account',
      email: 'device@example.test', plan: 'plus', active: false, usage: {}, auth: {}, lastModifiedAt: '2026-01-01T00:00:00Z' }] } });
    assert.equal(account.modern.status, 200);
    const provider = await pair.step('device fixture provider', 'PUT', '/sync/providers', { body: { providers: [{ id: 'device-provider',
      name: 'Fixture provider', group: 'Fixture group', baseUrl: 'https://example.test', apiKey: 'fixture',
      model: 'fixture-model', models: ['fixture-model'], apiFormat: 'openaiResponses',
      lastModifiedAt: '2026-01-01T00:00:00Z' }] } });
    assert.equal(provider.modern.status, 200);
    const { devices, subscribers } = await authenticateDevices(pair);
    allSockets.push(...Object.values(devices), ...Object.values(subscribers));
    await pair.step('online devices', 'GET', '/devices');
    await pair.step('available providers', 'GET', '/devices/providers');
    const rejected = await pair.step('reject deleting online device', 'DELETE', `/devices/${deviceID}`);
    assert.equal(rejected.modern.status, 409);
    await command(pair, devices, { path: 'account', type: 'switch-account', body: { accountId: 'device-account' } });
    await command(pair, devices, { path: 'provider', type: 'switch-provider', body: { providerId: 'device-provider' } });
    await command(pair, devices, { path: 'provider-group', type: 'switch-provider-group', body: { group: 'Fixture group' } });
    await command(pair, devices, { path: 'restart-codex', type: 'restart-codex' });
    await command(pair, devices, { path: 'openai-auth-account', type: 'set-openai-auth-account', body: { accountId: 'device-account' } });
    await command(pair, devices, { path: 'restart-codex', type: 'restart-codex', fail: true });
    await pair.step('unknown account switch rejected', 'POST', `/devices/${deviceID}/account`, { body: { accountId: 'missing' } });
    await exerciseHotChat(pair, allSockets);
    await exerciseLegacyChat(pair, allSockets);
    for (const socket of Object.values(devices)) socket.close();
    checkedFrames(pair, 'subscriber offline notification', await bothNext(subscribers, 'device-offline'));
    await pair.step('delete offline device', 'DELETE', `/devices/${deviceID}`);
    checkedFrames(pair, 'subscriber removed notification', await bothNext(subscribers, 'device-removed'));
    await pair.step('device no longer listed', 'GET', '/devices');
  } finally { for (const socket of allSockets) socket.close(); }
  return pair.results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runDevices();
  console.log(`Device/chat parity passed: ${results.length} checks`);
}
