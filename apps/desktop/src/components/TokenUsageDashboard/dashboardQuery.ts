import {
  isDesktopApp, isHostedWebApp, loadAccountQuotaHistory, loadDailyTokenUsage,
  loadTokenUsageBreakdown, loadTokenUsageEntries,
} from '../../api/backend';
import { invalidateTokenQueries, readTokenQuery } from '../../../../../shared/token-usage/queryCache';

interface Query { startTs: number; thresholdTokens: number; maxAgeMs: number }
let previousSource: string | null = null;
let previousCredential: string | undefined;
let sourceGeneration = 0;

function hostedCredential() {
  try { return sessionStorage.getItem('codex-switch:hosted-web-api-key') ?? ''; }
  catch { return ''; }
}

async function dataSource(key: string) {
  // These four datasets belong to this machine's app profile, across its Provider accounts.
  // Cloud-account official usage is deliberately loaded separately and never stored in this cache.
  if (isDesktopApp) return 'desktop-local';
  if (!isHostedWebApp) return 'preview';
  // Hosted credentials are per tab. Never let a different authenticated source reuse another tab's result.
  if (!key || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return `hosted:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function readDashboardQuery({ startTs, thresholdTokens, maxAgeMs }: Query) {
  const credential = isHostedWebApp ? hostedCredential() : '';
  if (credential !== previousCredential) {
    previousCredential = credential;
    sourceGeneration++;
  }
  const generation = sourceGeneration;
  const currentSource = () => generation === sourceGeneration &&
    (!isHostedWebApp || credential === hostedCredential());
  const source = await dataSource(credential).catch(() => null);
  if (!currentSource()) throw new Error('Token usage source changed during the request');
  if (source !== previousSource) {
    const retired = previousSource;
    previousSource = source;
    if (retired) await invalidateTokenQueries(`[${JSON.stringify(retired)},`);
  }
  if (!currentSource()) throw new Error('Token usage source changed during the request');
  const load = async () => {
    const endTs = Math.floor(Date.now() / 1000);
    const [entries, daily, breakdown, quota] = await Promise.allSettled([
      loadTokenUsageEntries(), loadDailyTokenUsage(startTs),
      loadTokenUsageBreakdown(startTs, thresholdTokens), loadAccountQuotaHistory(startTs, endTs),
    ]);
    return {
      entries: entries.status === 'fulfilled' ? entries.value : [],
      dailyUsage: daily.status === 'fulfilled' ? daily.value : [],
      breakdown: breakdown.status === 'fulfilled' ? breakdown.value : [],
      quotaHistory: quota.status === 'fulfilled' ? quota.value : [],
      error: entries.status === 'rejected' || daily.status === 'rejected',
      analyticsError: breakdown.status === 'rejected', quotaError: quota.status === 'rejected',
      updatedAt: new Date(), startTs, endTs,
    };
  };
  const key = JSON.stringify([source, 'dashboard', startTs, thresholdTokens]);
  const result = source ? await readTokenQuery({ key, maxAgeMs, load,
    cacheable: data => currentSource() && !data.error && !data.analyticsError && !data.quotaError }) : await load();
  // Authentication can change while the transport awaits a response or retries a rejected key.
  if (!currentSource()) throw new Error('Token usage source changed during the request');
  return result;
}
