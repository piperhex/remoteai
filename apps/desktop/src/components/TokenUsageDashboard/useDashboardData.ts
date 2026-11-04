import { useCallback, useEffect, useRef, useState } from "react";
import type { DailyTokenUsage, TokenUsageEntry } from "../../types";
import type { AccountQuotaHistory, DailyTokenUsageBreakdown } from "../../../../../shared/token-usage/analytics";
import { startOfCalendar } from "../../../../../shared/token-usage/chartUtils";
import { createDashboardLoader } from "../../../../../shared/token-usage/dashboardLoader";
import { readDashboardQuery } from "./dashboardQuery";
import { useViewActive } from '../../../../../shared/RetainedView';

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
  const enabled = useViewActive();
  const [data, setData] = useState<DashboardData>({
    entries: [], dailyUsage: [], breakdown: [], quotaHistory: [],
    error: false, analyticsError: false, quotaError: false, updatedAt: null,
    startTs: Math.floor(startOfCalendar(weeks).getTime() / 1000), endTs: Math.floor(Date.now() / 1000),
  });
  const [loading, setLoading] = useState(true);
  const scheduler = useRef(createDashboardLoader());
  const reload = useRef<() => void>(() => undefined);
  const scope = `${weeks}:${thresholdTokens}`;
  const previousScope = useRef(scope);

  useEffect(() => {
    if (!enabled) return;
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
    // A tab round trip preserves charts; only a different range invalidates the displayed scope.
    if (previousScope.current !== scope) {
      previousScope.current = scope;
      setLoading(true);
      setData((current) => ({ ...current, dailyUsage: [], breakdown: [], quotaHistory: [], updatedAt: null,
        startTs: Math.floor(startOfCalendar(weeks).getTime() / 1000), endTs: Math.floor(Date.now() / 1000) }));
    }
    reload.current = () => { void scheduler.current(task); };
    void scheduler.current(() => task(interval), true);
    return () => { active = false; reload.current = () => undefined; clearTimeout(timer); };
  }, [enabled, weeks, refreshSeconds, thresholdTokens, scope]);

  const load = useCallback(() => reload.current(), []);
  return { ...data, loading, load };
}
