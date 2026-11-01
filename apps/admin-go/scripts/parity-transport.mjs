import assert from 'node:assert/strict';
import { request } from './parity-client.mjs';

const stableHeaders = [
  'access-control-allow-origin', 'access-control-allow-credentials', 'access-control-allow-methods',
  'access-control-allow-headers', 'vary', 'x-powered-by', 'cache-control', 'content-type',
  'content-disposition', 'accept-ranges', 'content-range', 'location',
];
const missingID = '10000000-0000-4000-8000-000000000099';

export function assertLegacyVary(actual, expected) {
  const tokens = (value) => value?.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean) ?? [];
  const actualTokens = tokens(actual);
  assert.equal(new Set(actualTokens).size, actualTokens.length, 'Vary tokens must not repeat');
  // Go adds compression negotiation; every frozen CORS/cache variation must remain unchanged.
  const comparable = actualTokens.filter((token) => token !== 'accept-encoding');
  assert.deepEqual(comparable.sort(), tokens(expected).sort(), 'transport header vary');
}

function headersMatch(result, extra = []) {
  for (const key of [...stableHeaders, ...extra]) {
    if (key === 'vary') {
      assertLegacyVary(result.modern.headers[key], result.legacy.headers[key]);
      continue;
    }
    assert.equal(result.modern.headers[key], result.legacy.headers[key], `transport header ${key}`);
  }
}

async function checked(pair, label, method, path, options = {}, status = 200) {
  const result = await pair.step(`transport: ${label}`, method, path, { auth: false, ...options });
  assert.equal(result.legacy.status, status, `${label}: legacy status`);
  assert.equal(result.modern.status, status, `${label}: Go status`);
  headersMatch(result);
  return result;
}

async function cors(pair) {
  await checked(pair, 'without origin', 'GET', '/faqs');
  await checked(pair, 'reflected origin', 'GET', '/faqs', { headers: { Origin: 'https://fixture.example' } });
  await checked(pair, 'null origin', 'GET', '/faqs', { headers: { Origin: 'null' } });
  const simple = await checked(pair, 'preflight without origin', 'OPTIONS', '/unknown-route', {}, 204);
  headersMatch(simple, ['content-length']);
  const preflight = await checked(pair, 'preflight requested headers', 'OPTIONS', '/auth/login', {
    headers: {
      Origin: 'https://fixture.example', 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Authorization, Content-Type',
    },
  }, 204);
  headersMatch(preflight, ['content-length']);
  for (const method of ['POST', 'OPTIONS']) {
    await checked(pair, `${method} parser failure precedes CORS`, method, '/auth/login', {
      body: Buffer.from('{'), headers: { 'Content-Type': 'application/json', Origin: 'https://fixture.example' },
    }, 404);
  }
}

async function routing(pair) {
  for (const path of ['/faqs/', '/FAQS', '/FaQs/', '/ANNOUNCEMENTS/current', '/announcements/CURRENT/']) {
    await checked(pair, `route ${path}`, 'GET', path);
  }
  for (const path of ['/faqs//', '/auth/does-not-exist?x=1', '/faqs/missing']) {
    await checked(pair, `missing API ${path}`, 'GET', path, {}, 404);
  }
  await checked(pair, 'missing API POST', 'POST', '/faqs/missing', { body: {} }, 404);
  await checked(pair, 'encoded dynamic parameter', 'GET', `/prompt-plugins/${missingID.replace('1', '%31')}/install`, {}, 404);
  for (const [path, status] of [['/faqs', 200], ['/FAQS/', 200], ['/auth/does-not-exist?x=1', 404]]) {
    const result = await checked(pair, `HEAD ${path}`, 'HEAD', path, {}, status);
    headersMatch(result, ['content-length']);
    assert.equal(result.modern.body, '');
  }
}

async function safeMissingPages(pair) {
  for (const path of ['/', '/does-not-exist', '/admin/unknown', '/admin.css', '/faqs%2f', '/admin-assets/']) {
    const result = await pair.request('GET', path, { auth: false });
    // The legacy fallback exposes an absolute server path. Preserve the 404 while omitting that diagnostic.
    assert.deepEqual(result.legacy.body, {
      message: "ENOENT: no such file or directory, stat '/app/apps/admin/public/index.html'",
      error: 'Not Found', statusCode: 404,
    });
    assert.deepEqual(result.modern.body, { message: `Cannot GET ${path}`, error: 'Not Found', statusCode: 404 });
    headersMatch(result);
    pair.check(`transport: safe missing-page diagnostic ${path}`, result, (body) => ({
      error: body.error, statusCode: body.statusCode,
    }));
    assert.equal(result.modern.status, 404);
  }
}

async function conditional(pair, path, previous, method = 'GET') {
  const responses = {};
  for (const side of ['legacy', 'modern']) {
    assert.match(previous[side].headers.etag, /^W\/"[0-9a-f]+-.+"$/);
    responses[side] = await request(pair.urls[side], method, path, {
      headers: { 'If-None-Match': previous[side].headers.etag, 'Cache-Control': 'max-age=0' },
    });
  }
  pair.check(`transport: conditional ${method} ${path}`, responses);
  assert.equal(responses.legacy.status, 304);
  assert.equal(responses.modern.status, 304);
  headersMatch(responses);
}

function validatorsPresent(result) {
  headersMatch(result, ['content-length']);
  for (const side of ['legacy', 'modern']) {
    assert.match(result[side].headers.etag, /^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    assert.ok(!Number.isNaN(Date.parse(result[side].headers['last-modified'])));
  }
}

async function staticConditions(pair, page) {
  for (const [range, status] of [
    ['bytes=999999-', 416], ['bytes=bad', 200], ['bytes=1-0', 416],
    ['bytes=0-2,5-7', 200], ['bytes=0-2,2-5', 206], ['bytes=-3', 206],
  ]) await checked(pair, `static range ${range}`, 'GET', '/admin.html', { headers: { Range: range } }, status);
  await checked(pair, 'static precondition failed', 'GET', '/admin.html', {
    headers: { 'If-Match': '"different"' },
  }, 412);
  for (const header of ['If-Modified-Since', 'If-Match']) {
    const responses = {};
    for (const side of ['legacy', 'modern']) {
      const value = page[side].headers[header === 'If-Match' ? 'etag' : 'last-modified'];
      responses[side] = await request(pair.urls[side], 'GET', '/admin.html', {
        headers: { [header]: value, 'Cache-Control': 'max-age=0' },
      });
    }
    pair.check(`transport: static ${header}`, responses);
    assert.equal(responses.modern.status, header === 'If-Match' ? 200 : 304);
    headersMatch(responses);
  }
}

async function staticAssets(pair) {
  const page = await checked(pair, 'admin page bytes', 'GET', '/admin');
  validatorsPresent(page);
  for (const path of ['/admin/', '/ADMIN', '/admin/reset-password', '/admin.html']) {
    const result = await checked(pair, `static page ${path}`, 'GET', path);
    assert.equal(result.modern.body, page.modern.body);
    validatorsPresent(result);
  }
  const head = await checked(pair, 'admin HEAD', 'HEAD', '/admin');
  validatorsPresent(head);
  await conditional(pair, '/admin', page);
  await conditional(pair, '/admin', page, 'HEAD');
  const assetPaths = [...page.legacy.body.matchAll(/(?:src|href)="(\/admin-assets\/[^\"]+)"/g)]
    .map((match) => match[1]);
  assert.ok(assetPaths.some((path) => path.endsWith('.js')));
  assert.ok(assetPaths.some((path) => path.endsWith('.css')));
  for (const path of assetPaths) {
    const result = await checked(pair, `asset bytes ${path}`, 'GET', path, { binary: true });
    validatorsPresent(result);
  }
  const range = await checked(pair, 'static byte range', 'GET', '/admin.html', {
    binary: true, headers: { Range: 'bytes=0-15' },
  }, 206);
  assert.equal(range.modern.body.length, 16);
  validatorsPresent(range);
  await staticConditions(pair, page);
  await checked(pair, 'static directory redirect', 'GET', '/admin-assets', {}, 301);
}

export async function runTransport(pair) {
  await cors(pair);
  await routing(pair);
  const api = await checked(pair, 'API ETag', 'GET', '/faqs');
  await conditional(pair, '/faqs', api);
  await conditional(pair, '/faqs', api, 'HEAD');
  await staticAssets(pair);
  await safeMissingPages(pair);
}
