import { useCallback, useEffect, useRef, useState } from "react";
import type { DailyTokenUsage, TokenUsageEntry } from "../../types";
import type { AccountQuotaHistory, DailyTokenUsageBreakdown } from "../../types/tokenUsageAnalytics";
import { startOfCalendar } from "./chartUtils";
import { createDashboardLoader } from "./dashboardLoader";
import { readDashboardQuery } from "./dashboardQuery";

interface DashboardData {
  entries: TokenUsageEntry[];
  dailyUsage: DailyTokenUsage[];
  breakdown: DailyTokenUsageBreakdown[];
  quotaHistory: AccountQuotaHistory[];
  error: boolean;
  analyticsError: boolean;
  quotaError: boolean;
  updatedAt: Date | null;
  startTs: number;
  endTs: number;
}

interface DashboardOptions { weeks: number; refreshSeconds: number; thresholdTokens: number }

export function useDashboardData({ weeks, refreshSeconds, thresholdTokens }: DashboardOptions) {
  const [data, setData] = useState<DashboardData>({
    entries: [], dailyUsage: [], breakdown: [], quotaHistory: [],
    error: false, analyticsError: false, quotaError: false, updatedAt: null,
    startTs: Math.floor(startOfCalendar(weeks).getTime() / 1000), endTs: Math.floor(Date.now() / 1000),
  });
  const [loading, setLoading] = useState(true);
  const scheduler = useRef(createDashboardLoader());
  const reload = useRef<() => void>(() => undefined);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const interval = refreshSeconds * 1000;
    const task = async (maxAgeMs = 0) => {
      if (!active) return;
      clearTimeout(timer);
      if (!maxAgeMs) setLoading(true);
      const startTs = Math.floor(startOfCalendar(weeks).getTime() / 1000);
      let nextRefresh = Date.now() + interval;
      try {
        const next = await readDashboardQuery({ startTs, thresholdTokens, maxAgeMs });
        nextRefresh = next.updatedAt.getTime() + interval + 1;
        if (active) setData(current => current.updatedAt?.getTime() === next.updatedAt.getTime() ? current : next);
      } catch {
        if (active) setData(current => ({ ...current, error: true }));
      } finally {
        if (active) {
          setLoading(false);
          timer = setTimeout(() => void scheduler.current(() => task(interval)), Math.max(1, nextRefresh - Date.now()));
        }
      }
    };
    // Clear the previous scope immediately so it cannot be shown under a new range or threshold.
    setData((current) => ({ ...current, dailyUsage: [], breakdown: [], quotaHistory: [], updatedAt: null,
      startTs: Math.floor(startOfCalendar(weeks).getTime() / 1000), endTs: Math.floor(Date.now() / 1000) }));
    setLoading(true);
    reload.current = () => { void scheduler.current(task); };
    void scheduler.current(task, true);
    return () => { active = false; reload.current = () => undefined; clearTimeout(timer); };
  }, [weeks, refreshSeconds, thresholdTokens]);

  const load = useCallback(() => reload.current(), []);
  return { ...data, loading, load };
}
