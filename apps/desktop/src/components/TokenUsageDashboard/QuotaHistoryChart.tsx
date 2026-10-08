import { useCallback, useEffect, useMemo, useState } from "react";
import { Segmented, Select } from "antd";
import type { Language } from "../../i18n";
import type { AccountQuotaHistory } from "../../types/tokenUsageAnalytics";
import { EChart } from "./EChart";
import { quotaChartLabels } from "./quotaChartLabels";
import { quotaChartDescription, quotaChartOption } from "./quotaChartOption";
import { buildQuotaChartData, type QuotaInterval, type QuotaView } from "./quotaHistoryData";
import type { QuotaVisibleRange } from "./quotaSeriesSampling";
import styles from "./quotaHistory.module.less";

interface AccountQuotaChartProps {
  history: AccountQuotaHistory[];
  startTs: number;
  endTs: number;
  language: Language;
  dark: boolean;
  themeColor: string;
  loading?: boolean;
  error?: string | null;
}

export function AccountQuotaChart(props: AccountQuotaChartProps) {
  const { history, startTs, endTs, language, dark, themeColor, loading = false, error } = props;
  const [accountId, setAccountId] = useState<string>();
  const [interval, setInterval] = useState<QuotaInterval>("sixHours");
  const [view, setView] = useState<QuotaView>("drop");
  const [zoom, setZoom] = useState<{ key: string; range: QuotaVisibleRange }>();
  const selected = history.find((account) => account.accountId === accountId) ?? history[0];
  const zoomKey = `${selected?.accountId ?? ""}:${interval}:${view}:${startTs}`;
  const visibleRange = zoom?.key === zoomKey ? zoom.range : undefined;
  useEffect(() => { setZoom(undefined); }, [zoomKey]);
  const onZoomChange = useCallback((range: QuotaVisibleRange) => {
    setZoom((current) => current?.key === zoomKey && current.range.startValue === range.startValue
      && current.range.endValue === range.endValue ? current : { key: zoomKey, range });
  }, [zoomKey]);
  const labels = quotaChartLabels(language);
  const data = useMemo(() => buildQuotaChartData({
    points: selected?.points ?? [], startTs, endTs, interval, view,
  }), [selected?.points, startTs, endTs, interval, view]);
  const option = useMemo(() => quotaChartOption({
    data, accountLabel: selected?.accountLabel ?? "", startTs, endTs, interval, view, language, dark, themeColor,
    visibleRange,
  }), [data, selected?.accountLabel, startTs, endTs, interval, view, language, dark, themeColor, visibleRange]);
  const chartDescription = quotaChartDescription({ language, accountLabel: selected?.accountLabel ?? "", view });
  return (
    <section className={styles.panel} aria-busy={loading}>
      <div className={styles.heading}>
        <h2>{labels.title}</h2>
        <Select showSearch optionFilterProp="label" value={selected?.accountId}
          onChange={setAccountId} className={styles.accountSelect} aria-label={labels.account}
          placeholder={labels.account} notFoundContent={labels.noAccounts}
          options={history.map((account) => ({ value: account.accountId, label: account.accountLabel }))} />
      </div>
      <div className={styles.controls}>
        <Segmented value={view} onChange={(value) => setView(value as QuotaView)}
          aria-label={labels.view} options={[
            { value: "remaining", label: labels.remaining }, { value: "drop", label: labels.drop },
          ]} />
        <Select value={interval} onChange={setInterval} aria-label={labels.interval}
          className={styles.intervalSelect} options={[
            { value: "hour", label: labels.hour }, { value: "sixHours", label: labels.sixHours },
            { value: "day", label: labels.day },
          ]} />
      </div>
      {error ? <p className={styles.error} role="status">{labels.error}</p> : null}
      <div className={styles.chart}>
        {data.hasData ? <EChart option={option} label={chartDescription} preserveZoomKey={zoomKey}
          onZoomChange={onZoomChange} />
          : <div className={styles.empty} role="status">{loading ? labels.loading : labels.empty}</div>}
      </div>
      <p className={styles.hint}>{view === "drop" ? labels.dropHint : labels.remainingHint}</p>
      {data.hasData ? <p className={styles.hint}>{labels.zoomHint}</p> : null}
      <p className={styles.hint}>{labels.historyHint}</p>
    </section>
  );
}
