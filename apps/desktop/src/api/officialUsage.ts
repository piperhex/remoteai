import { hasLocalBackend, invoke } from './backend';
import type { OfficialUsageSummary } from '../../../../shared/officialUsage';

export async function loadOfficialUsage(startTs = 0): Promise<OfficialUsageSummary> {
  if (hasLocalBackend) return invoke<OfficialUsageSummary>('get_official_usage_summary', { startTs });
  return { accounts: [], status: 'signedOut', updatedAt: Math.floor(Date.now() / 1000) };
}
