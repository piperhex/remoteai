import { getLocale, t, useLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import { useTokenSummary } from '../../../../shared/remote-chat/client/useTokenSummary';
import type { ReadTokenSummary, TokenSummary, UsageRanking } from '../../../../shared/remote-chat/tokenSummary';
import { formatTokens } from '../../../../shared/remote-chat/usage';
import type { DailyTokenUsageBreakdown } from '../../../desktop/src/types/tokenUsageAnalytics';
import { TokenBars, TokenQuota } from './ChatTokenCharts';
import { OfficialUsagePanel } from './OfficialUsagePanel';
import './tokenSummary.css';

const TOKEN_FIELDS = [['总计', 'totalTokens'], ['输入', 'inputTokens'], ['输出', 'outputTokens'],
  ['推理', 'reasoningTokens'], ['缓存', 'cachedTokens']] as const;
type BreakdownField = Exclude<keyof DailyTokenUsageBreakdown, 'date'>;
const CONTEXT_FIELDS: Array<[string, BreakdownField]> = [['短上下文', 'shortContextTokens'],
  ['长上下文', 'longContextTokens'], ['未识别', 'unknownContextTokens']];
const MODE_FIELDS: Array<[string, BreakdownField]> = [['普通模式', 'standardModeTokens'],
  ['快速模式', 'fastModeTokens'], ['未识别', 'unknownModeTokens']];

function Ranking({ title, ranking, count }: { title: string; ranking: UsageRanking; count: number }) {
  useLanguage();
  const total = ranking.reduce((sum, [, tokens]) => sum + tokens, 0);
  return <section className="chat-token-card"><h3>{title}</h3>
    <p className="chat-muted">{t("基于最近")} {count}  {t("条代理请求 · 前 8 名")}</p>
    {ranking.map(([name, tokens], index) => <div className="chat-token-ranking" key={name}>
      <span>{index + 1}. {name}</span><strong>{formatTokens(tokens)}</strong>
      <small>{total ? (tokens / total * 100).toFixed(1) : '0.0'}%</small>
      <progress max={Math.max(1, ...ranking.map(([, value]) => value))} value={tokens} />
    </div>)}{!ranking.length && <p className="chat-muted">{t("暂无 Token 数据")}</p>}
  </section>;
}
function Consumption({ data, title, fields, hint }: {
  data: TokenSummary; title: string; fields: Array<[string, BreakdownField]>; hint: string;
}) {
  useLanguage();
  const daily = new Map(data.breakdown.map(day => [day.date, day]));
  return <section className="chat-token-card"><h3>{title}</h3><p className="chat-muted">{hint}</p>
    {data.errors.analytics ? <p className="chat-error">{t("消耗统计加载失败，请刷新重试。")}</p> : <>
      <div className="chat-token-metrics">{fields.map(([name, field]) => <div key={field}><small>{t(name)}</small>
        <strong>{formatTokens(data.breakdown.reduce((sum, day) => sum + day[field], 0))}</strong></div>)}</div>
      <TokenBars labels={fields.map(([label]) => t(label))} points={data.dateKeys.map(date => ({
        label: date, values: fields.map(([, field]) => daily.get(date)?.[field] ?? 0),
      }))} />
    </>}
  </section>;
}
function SummaryContent({ data }: { data: TokenSummary }) {
  useLanguage();
  const daily = new Map(data.dailyUsage.map(day => [day.date, day]));
  const maximum = Math.max(1, ...data.dailyUsage.map(day => day.totalTokens));
  return <>
    <section className="chat-token-card"><h3>{t("最近")} {data.weeks}  {t("周 · Token 总消耗")}</h3>
      <div className="chat-token-metrics">{TOKEN_FIELDS.map(([label, field]) => <div key={field}><small>{t(label)}</small>
        <strong>{formatTokens(data.dailyUsage.reduce((sum, day) => sum + day[field], 0))}</strong></div>)}</div>
      {data.errors.usage && <p className="chat-error">{t("部分 Token 数据加载失败，请刷新重试。")}</p>}
    </section>
    <TokenQuota data={data} />
    <OfficialUsagePanel data={data} />
    <Consumption data={data} title={t("短 / 长上下文消耗")} fields={CONTEXT_FIELDS}
      hint={t("单次输入超过 {value1} Tokens（含缓存）计为长上下文。", { value1: data.thresholdTokens.toLocaleString(getLocale()) })} />
    <Consumption data={data} title={t("普通 / 快速模式消耗")} fields={MODE_FIELDS}
      hint={t("按每日实际 Token 数统计；缺少模式记录的消耗归入“未识别”。")} />
    <section className="chat-token-card"><h3>{t("每日活跃度")}</h3><div className="chat-token-heatmap">
      {data.dateKeys.map(date => { const tokens = daily.get(date)?.totalTokens ?? 0;
        return <span key={date} tabIndex={0} title={`${date} · ${formatTokens(tokens)} Token`}
          aria-label={`${date} · ${formatTokens(tokens)} Token`}
          style={{ background: `rgba(20,128,111,${tokens ? .2 + tokens / maximum * .8 : .07})` }} />;
      })}</div></section>
    <section className="chat-token-card"><h3>{t("每日 Token 趋势")}</h3>
      <TokenBars labels={TOKEN_FIELDS.map(([label]) => t(label))} points={data.dateKeys.map(date => ({ label: date,
        values: TOKEN_FIELDS.map(([, field]) => daily.get(date)?.[field] ?? 0),
      }))} /></section>
    <Ranking title={t("Provider 消耗排行")} ranking={data.rankings.providers} count={data.entryCount} />
    <Ranking title={t("模型消耗排行")} ranking={data.rankings.models} count={data.entryCount} />
    <Ranking title={t("账户消耗排行")} ranking={data.rankings.accounts} count={data.entryCount} />
  </>;
}
export function ChatTokenSummary({ read, ready, deviceName, onClose }: {
  read: ReadTokenSummary; ready: boolean; deviceName?: string; onClose: () => void;
}) {
  useLanguage();
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const summary = useTokenSummary({ read, active: ready && visible });
  const [weeks, setWeeks] = useState('');
  useEffect(() => { setWeeks(String(summary.weeks ?? '')); }, [summary.weeks]);
  return <AdaptiveSheet open title={t("Token 汇总")} width={900} onClose={onClose} onBack={onClose}>
    <div className="chat-token-summary chat-scroll"><p className="chat-muted">
      {deviceName || t("尚未选择电脑")}  {t("· 仅统计代理模式的 Token 消耗")}</p>
      <form className="chat-row" onSubmit={event => { event.preventDefault(); summary.changeWeeks(Number(weeks)); }}>
        <label htmlFor="chat-summary-weeks">{t("最近")}</label><input id="chat-summary-weeks" type="number" min={1} max={52}
          required aria-label={t("统计周数，1 至 52 周")} value={weeks} onChange={event => setWeeks(event.target.value)} />
        <span className="chat-grow">{t("周")}</span><button type="submit" className="chat-button">{t("应用")}</button>
        <button type="button" className="chat-button" aria-label={t("刷新 Token 汇总")} disabled={!ready || summary.loading}
          onClick={summary.refresh}>{summary.loading ? t("正在更新…") : t("刷新")}</button></form>
      {!ready && <p className="chat-muted">{t("连接电脑后即可查看 Token 汇总。")}</p>}
      {summary.error && <p role="alert" className="chat-error">{t(summary.error)}</p>}
      {summary.data && <><p className="chat-muted">{t("更新于")} {new Date(summary.data.endTs * 1000).toLocaleTimeString(getLocale())}</p>
        <SummaryContent data={summary.data} /></>}
    </div>
  </AdaptiveSheet>;
}
