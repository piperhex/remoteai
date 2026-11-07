import { execFileSync } from 'node:child_process';
import { defineConfig, mergeConfig } from 'vite';
import config from '../scripts/vite.config';

// Measurement-only transforms. Both runs use the same running UI and preview data;
// the baseline restores the original hook and always-mounted panel from this task's starting commit.
export default mergeConfig(config, defineConfig({
  cacheDir: '../../.codex-tmp/token-lifecycle/vite-cache',
  optimizeDeps: { entries: ['index.html'] },
  server: { hmr: false, watch: { ignored: ['**'] } },
  plugins: [{ name: 'token-lifecycle-measurement', enforce: 'pre', transform(source, id) {
    if (id.endsWith('/shared/token-usage/useWindowVisible.ts')) {
      for (const [name, call] of [['visible', 'current.isVisible()'], ['minimized', 'current.isMinimized()']]) {
        source = source.replaceAll(call,
          `(window.__windowProbe ? window.__windowProbe('${name}', () => ${call}) : ${call})`);
      }
    }
    if (id.includes('/TokenUsagePanel.tsx') && process.env.TOKEN_BASELINE === '1') {
      source = source.replace('if (!active || !visible) return null;', 'void active; void visible;');
    }
    if (id.endsWith('/TokenUsageDashboard/useDashboardData.ts') && process.env.TOKEN_BASELINE === '1') {
      source = execFileSync('git', ['show',
        '04776426e:apps/desktop/src/components/TokenUsageDashboard/useDashboardData.ts'], { encoding: 'utf8' });
    }
    if (/\/TokenUsageDashboard\/(useDashboardData|dashboardQuery)\.ts$/.test(id)) {
      for (const [name, call] of [['entries', 'loadTokenUsageEntries()'], ['daily', 'loadDailyTokenUsage(startTs)'],
        ['breakdown', 'loadTokenUsageBreakdown(startTs, thresholdTokens)'],
        ['quota', 'loadAccountQuotaHistory(startTs, endTs)']]) {
        source = source.replaceAll(call, `(window.__tokenProbe ? window.__tokenProbe('${name}', () => ${call}) : ${call})`);
      }
    }
    if (id.endsWith('/TokenUsageDashboard/index.tsx')) {
      source = source.replace('const thresholdTokens =', 'window.__tokenCount?.("renders"); const thresholdTokens =');
    }
    if (id.endsWith('/TokenUsageDashboard/EChart.tsx')) {
      source = source.replace('chart.setOption(', 'window.__tokenCount?.("draws"); chart.setOption(');
    }
    return source;
  } }],
}));
