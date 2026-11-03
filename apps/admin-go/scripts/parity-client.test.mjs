import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeLegacyResponse } from './parity-client.mjs';

const normalize = (value) => normalizeLegacyResponse(value, { ids: new Map(), aliases: new Map() });

test('only known Go market permissions are excluded from the frozen contract', () => {
  const permissions = ['admin.users.read', 'admin.provider-market.read', 'admin.provider-market.manage',
    'admin.provider-market.order', 'admin.provider-market.review', 'admin.provider-market.promote',
    'admin.provider-market.unknown', 'unexpected.permission'];
  assert.deepEqual(normalize({ permissions }).permissions,
    ['admin.provider-market.unknown', 'admin.users.read', 'unexpected.permission']);
  assert.deepEqual(normalize(permissions.map((code) => ({ code }))),
    [{ code: 'admin.users.read' }, { code: 'admin.provider-market.unknown' }, { code: 'unexpected.permission' }]);
});

test('old Providers cannot acquire an enabled balance parser', () => {
  const provider = { modelApiFormats: {}, apiKey: 'private-fixture', balanceScript: null,
    fieldModifiedAt: { balanceScript: '2026-10-30T00:00:00.000Z' } };
  assert.deepEqual(normalize(provider), { apiKey: 'private-fixture', fieldModifiedAt: {}, modelApiFormats: {} });
  assert.throws(() => normalize({ ...provider, balanceScript: {} }), /must not acquire a balance parser/);
  assert.throws(() => normalize({ ...provider, fieldModifiedAt: { balanceScript: 'invalid' } }), /ISO timestamp/);
  assert.deepEqual(normalize({ balanceScript: 'unrelated' }), { balanceScript: 'unrelated' });
});

test('additive lounge settings must keep defaults for frozen clients', () => {
  const defaults = { loungeFileMaxMb: 300, loungeGroupImageMaxMb: 1, loungeDirectImageMaxMb: 1 };
  assert.deepEqual(normalize({ threadPageSize: 30, ...defaults }), { threadPageSize: 30 });
  for (const field of Object.keys(defaults)) {
    assert.throws(() => normalize({ threadPageSize: 30, ...defaults, [field]: -1 }), /must preserve/);
  }
  assert.deepEqual(normalize({ loungeFileMaxMb: 9 }), { loungeFileMaxMb: 9 });
});

test('old Providers cannot acquire market page access', () => {
  const provider = { modelApiFormats: {}, marketSource: null,
    fieldModifiedAt: { marketSource: '2026-10-30T00:00:00.000Z' } };
  assert.deepEqual(normalize(provider), { fieldModifiedAt: {}, modelApiFormats: {} });
  assert.throws(() => normalize({ ...provider, marketSource: {} }), /must not acquire market page access/);
  assert.throws(() => normalize({ ...provider, fieldModifiedAt: { marketSource: 'invalid' } }), /ISO timestamp/);
  assert.deepEqual(normalize({ marketSource: 'unrelated' }), { marketSource: 'unrelated' });
});

test('frozen chat settings preserve the Go remote command concurrency default', () => {
  assert.deepEqual(normalize({ threadPageSize: 30, remoteCommandConcurrencyLimit: 5 }), { threadPageSize: 30 });
  for (const limit of [0, 1, 6, '5', null]) {
    assert.throws(() => normalize({ threadPageSize: 30, remoteCommandConcurrencyLimit: limit }),
      /must preserve remoteCommandConcurrencyLimit/);
  }
  assert.deepEqual(normalize({ remoteCommandConcurrencyLimit: 6 }), { remoteCommandConcurrencyLimit: 6 });
  assert.deepEqual(normalize({ threadPageSize: 30, unknownSetting: 5 }),
    { threadPageSize: 30, unknownSetting: 5 });
});
