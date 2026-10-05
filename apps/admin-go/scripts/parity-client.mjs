import assert from 'node:assert/strict';

export const fixturePassword = 'Parity-admin-2026!';
export const fixtureUsers = {
  admin: { id: '00000000-0000-4000-8000-000000000001', email: 'admin-fixture@example.test' },
  user: { id: '00000000-0000-4000-8000-000000000002', email: 'user-fixture@example.test' },
  restricted: { id: '00000000-0000-4000-8000-000000000003', email: 'restricted-fixture@example.test' },
  disabled: { id: '00000000-0000-4000-8000-000000000004', email: 'disabled-fixture@example.test' },
  reviewer: { id: '00000000-0000-4000-8000-000000000005', email: 'reviewer-fixture@example.test' },
};
const sides = ['legacy', 'modern'];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoPattern = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const sensitiveRuntimeKeys = new Set(['accessToken', 'refreshToken', 'passwordHash']);
// Go-only permissions are exercised by token-pricing-smoke.mjs and chat-traffic-smoke.mjs.
const goOnlyPermissions = new Set([
  'admin.token-pricing.read', 'admin.token-pricing.manage',
  'admin.chat-traffic.read', 'admin.chat-traffic.manage',
]);
// The chat policy/limit smoke tests cover these additions; compare only the frozen Nest contract here.
const goOnlyChatFields = new Set([
  'chatSessionLimit',
  'p2pNegotiationTimeoutSeconds', 'p2pRetryIntervalSeconds', 'p2pDisconnectGraceSeconds',
  'relayHeartbeatTimeoutSeconds', 'fileDownloadWindowSize', 'fileBulkEnabled',
]);
const goOnlyDeviceFields = new Set(['guiAccountId', 'guiProviderId']);

function legacyDeviceField(value, field) {
  if (!('deviceId' in value) || !goOnlyDeviceFields.has(field)) return true;
  // Frozen desktops cannot select a GUI model; the additive fields must stay empty.
  assert.equal(value[field], null, `legacy device must not acquire ${field}`);
  return false;
}

export async function request(base, method, path, options = {}) {
  const headers = { ...options.headers };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  let body = options.body;
  if (body !== undefined && !(body instanceof FormData) && !Buffer.isBuffer(body)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(base + path, { method, headers, body, redirect: 'manual' });
  let value;
  if (options.binary) value = Buffer.from(await response.arrayBuffer());
  else {
    const text = await response.text();
    try { value = JSON.parse(text); } catch { value = text; }
  }
  return { status: response.status, body: value, headers: Object.fromEntries(response.headers) };
}

function normalized(value, context, key = '') {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') {
    if (context.aliases.has(value)) return context.aliases.get(value);
    if (sensitiveRuntimeKeys.has(key)) {
      assert.ok(value.length > 20, `${key} must contain an actual credential`);
      return `<${key}>`;
    }
    if (key === 'token' && /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(value)) {
      return `${normalized(value.slice(0, 36), context)}.<invitation HMAC>`;
    }
    if (isoPattern.test(value)) return '<ISO timestamp>';
    if (uuidPattern.test(value)) {
      if (!context.ids.has(value)) context.ids.set(value, `UUID-${context.ids.size}`);
      return context.ids.get(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    const legacyValues = value.filter((item) => {
      if (key === 'permissions' && typeof item === 'string') return !goOnlyPermissions.has(item);
      return !(item && typeof item === 'object' && goOnlyPermissions.has(item.code));
    });
    const result = legacyValues.map((item) => normalized(item, context));
    // Permissions are a set; TypeORM and GORM do not promise join-row ordering.
    return key === 'permissions' ? result.sort() : result;
  }
  if (value && typeof value === 'object') {
    // Frozen clients do not advertise binary support; their negotiated hop must remain JSON.
    const legacyPolicy = value.type === 'chat-policy' && 'binaryRelay' in value;
    if (legacyPolicy) {
      assert.equal(value.binaryRelay, false, 'unadvertised binary relay must stay disabled');
      assert.equal(value.fileBulkV1, false, 'unadvertised bulk relay must stay disabled');
    }
    if ('threadPageSize' in value && 'fileBulkEnabled' in value) {
      assert.equal(value.fileBulkEnabled, 0, 'legacy settings must keep bulk downloads disabled');
    }
    const fields = Object.keys(value).filter((field) => !(goOnlyChatFields.has(field) && 'threadPageSize' in value)
      && !(legacyPolicy && ['binaryRelay', 'fileBulkV1'].includes(field)) && legacyDeviceField(value, field));
    return Object.fromEntries(fields.sort().map((field) => [field, normalized(value[field], context, field)]));
  }
  return value;
}

export async function createPair(options = {}) {
  const urls = { legacy: options.legacy ?? 'http://127.0.0.1:28080', modern: options.modern ?? 'http://127.0.0.1:28081' };
  const tokens = { legacy: '', modern: '' };
  const contexts = { legacy: { ids: new Map(), aliases: new Map() }, modern: { ids: new Map(), aliases: new Map() } };
  const results = [];
  const requests = new WeakMap();
  const pair = {
    urls, tokens, results,
    alias(legacy, modern, label) {
      contexts.legacy.aliases.set(legacy, label);
      contexts.modern.aliases.set(modern, label);
    },
    async request(method, path, opts = {}) {
      const output = {};
      for (const [index, side] of sides.entries()) {
        const token = opts.auth === false ? '' : Array.isArray(opts.auth) ? opts.auth[index] : tokens[side];
        output[side] = await request(urls[side], method, Array.isArray(path) ? path[index] : path, {
          ...opts, token, body: opts.sideBody ? await opts.sideBody(side) : opts.body,
        });
      }
      requests.set(output, { method, path: Array.isArray(path) ? path[0] : path });
      return output;
    },
    check(label, responses, transform = (value) => value) {
      try {
        assert.equal(responses.modern.status, responses.legacy.status, `${label}: status differs`);
        const left = normalized(transform(responses.legacy.body, 'legacy'), contexts.legacy);
        const right = normalized(transform(responses.modern.body, 'modern'), contexts.modern);
        assert.deepEqual(right, left, `${label}: response differs`);
      } catch (error) {
        if (process.env.PARITY_COLLECT !== '1') throw error;
        results.push({ label, ...requests.get(responses), failed: true, error: error.message });
        process.exitCode = 1;
        console.error(`FAIL ${label}: ${error.message}`);
        return responses;
      }
      results.push({ label, ...requests.get(responses), status: responses.legacy.status });
      process.stdout.write(`PASS ${label} (${responses.legacy.status})\n`);
      return responses;
    },
    async step(label, method, path, opts = {}) {
      return pair.check(label, await pair.request(method, path, opts), opts.normalize);
    },
    async login(role = 'admin') {
      const responses = await pair.request('POST', '/auth/login', {
        auth: false, body: { email: fixtureUsers[role].email, password: fixturePassword },
      });
      pair.check(`login ${role}`, responses);
      assert.equal(responses.legacy.status, 201);
      return sides.map((side) => responses[side].body.accessToken);
    },
  };
  const auth = await pair.login('admin');
  for (const [index, side] of sides.entries()) tokens[side] = auth[index];
  return pair;
}

export function paths(prefix, responses, suffix = '') {
  return sides.map((side) => `${prefix}${responses[side].body.id}${suffix}`);
}
