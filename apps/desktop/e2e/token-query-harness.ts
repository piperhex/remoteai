import { readTokenQuery } from '../../../shared/token-usage/queryCache';

declare global {
  interface Window {
    query: (key: string, maxAgeMs: number) => Promise<unknown>;
    dashboardQuery: (startTs: number, thresholdTokens: number) => Promise<unknown>;
  }
}
if (location.search.includes('hosted')) {
  const meta = document.createElement('meta');
  meta.name = 'codex-switch-runtime'; meta.content = 'hosted'; document.head.append(meta);
}
window.query = (key, maxAgeMs) => readTokenQuery({ key, maxAgeMs,
  load: () => fetch(`/query-fixture?key=${encodeURIComponent(key)}`).then(response => response.json()) });
window.dashboardQuery = async (startTs, thresholdTokens) => {
  const { readDashboardQuery } = await import('../src/components/TokenUsageDashboard/dashboardQuery');
  return readDashboardQuery({ startTs, thresholdTokens, maxAgeMs: 60000 });
};
