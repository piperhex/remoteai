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
  '20261009-official-usage.sql',
  '20261009-official-usage-v2.sql',
  '20261015-provider-request-options.sql',
  '20261015-aggregate-sync.sql',
  '20261015-update-sharing.sql',
  '20261015-port-mappings.sql',
  '20261017-update-download-reports.sql',
  '20261024-ssh-profiles.sql',
  '20261025-ssh-credentials.sql',
  '20261028-lounge-moderation.sql',
  '20261028-lounge-blocks.sql',
  '20261028-lounge-direct-permissions.sql',
  '20261028-lounge-profiles.sql',
  '20261029-lounge-direct-reset.sql',
  '20261029-lounge-names.sql',
  '20261029-lounge-notifications.sql',
  '20261029_provider_market.sql',
  '20261030_provider_market_page.sql',
  '20261101-lounge-avatar-resolution.sql',
  '20261102_provider_market_review.sql',
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
