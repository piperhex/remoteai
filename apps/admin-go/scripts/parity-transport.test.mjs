import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertLegacyVary } from './parity-transport.mjs';

test('compression may add encoding negotiation while preserving every legacy Vary token', () => {
  assertLegacyVary('Origin, Accept-Encoding', 'Origin');
  assertLegacyVary('Accept-Encoding, origin, Access-Control-Request-Headers',
    'Origin, Access-Control-Request-Headers');
  assertLegacyVary('Origin', 'Origin');
  assertLegacyVary(undefined, undefined);
  assert.throws(() => assertLegacyVary('Accept-Encoding', 'Origin'), /transport header vary/);
  assert.throws(() => assertLegacyVary('Origin, X-Unexpected', 'Origin'), /transport header vary/);
  assert.throws(() => assertLegacyVary('Origin, Accept-Encoding, accept-encoding', 'Origin'), /must not repeat/);
});
