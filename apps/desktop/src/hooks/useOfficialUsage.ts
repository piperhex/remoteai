import { useEffect, useRef, useState } from 'react';
import { loadOfficialUsage } from '../api/officialUsage';
import type { OfficialUsageSummary } from '../../../../shared/officialUsage';
import { createDashboardLoader } from '../components/TokenUsageDashboard/dashboardLoader';

export function useOfficialUsage(options: { active: boolean; refreshSeconds: number; startTs?: number; refreshKey?: unknown }) {
  const { active, refreshSeconds, startTs = 0, refreshKey } = options;
  const [data, setData] = useState<OfficialUsageSummary>();
  const [error, setError] = useState(false);
  const scheduler = useRef(createDashboardLoader());
  useEffect(() => {
    if (!active) return;
    let mounted = true;
    const task = async () => {
      if (!mounted) return;
      try {
        const next = await loadOfficialUsage(startTs);
        if (mounted) { setData(next); setError(false); }
      } catch {
        if (mounted) { setData(undefined); setError(true); }
      }
    };
    void scheduler.current(task, true);
    const timer = window.setInterval(() => void scheduler.current(task), Math.max(60, refreshSeconds) * 1000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [active, refreshSeconds, refreshKey, startTs]);
  const accounts = data?.accounts ?? [];
  return { accounts, data, error, loading: !data && !error };
}
