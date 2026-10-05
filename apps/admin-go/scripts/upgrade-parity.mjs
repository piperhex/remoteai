import { readFile } from 'node:fs/promises';
import { fixtureDatabase } from './seed-parity.mjs';

const migrations = [
  '20260923-token-cost-presets.sql',
  '20260923-user-login-locks.sql',
  '20260923-chat-user-traffic.sql',
  '20260923-chat-relay-budgets.sql',
  '20260924-device-gui-model-selection.sql',
  '20260928-chat-push.sql',
  '20260928-desktop-service.sql',
  '20261005-chat-bulk-leases.sql',
];

// The frozen Nest schema lacks Go additions; upgrade only the fixed localhost fixture database.
export async function upgradeParityDatabase() {
  const database = await fixtureDatabase('admin_go');
  try {
    for (const migration of migrations) {
      await database.query(await readFile(new URL(`../sql/${migration}`, import.meta.url), 'utf8'));
    }
  } finally { await database.end(); }
  console.log('Isolated Go fixture migrations applied');
}
