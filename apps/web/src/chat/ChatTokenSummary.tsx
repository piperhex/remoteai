import { displayError } from '../i18n/index';
import { getLocale, t, useLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import { useTokenSummary } from '../../../../shared/remote-chat/client/useTokenSummary';
import { useWindowVisible } from '../../../../shared/token-usage/useWindowVisible';
import type { ReadTokenSummary, TokenSummary, UsageRanking } from '../../../../shared/remote-chat/tokenSummary';
import { formatTokens } from '../../../../shared/remote-chat/usage';
import { TOKEN_FIELDS, CONTEXT_FIELDS, MODE_FIELDS, type ConsumptionField }
  from '../../../../shared/remote-chat/tokenSummaryLabels';
import { TokenBars, TokenQuota } from './ChatTokenCharts';
import { OfficialUsagePanel } from './OfficialUsagePanel';
import './tokenSummary.css';

function Ranking({ title, ranking, count }: { title: string; ranking: UsageRanking; count: number }) {
  useLanguage();
  const total = ranking.reduce((sum, [, tokens]) => sum + tokens, 0);
  return <section className="chat-token-card"><h3>{title}</h3>
    <p className="chat-muted">{t("client.chat.basedOnTheLatest")} {count}  {t("client.chat.proxyRequestsTop8")}</p>
    {ranking.map(([name, tokens], index) => <div className="chat-token-ranking" key={name}>
      <span>{index + 1}. {name}</span><strong>{formatTokens(tokens)}</strong>
      <small>{total ? (tokens / total * 100).toFixed(1) : '0.0'}%</small>
      <progress max={Math.max(1, ...ranking.map(([, value]) => value))} value={tokens} />
    </div>)}{!ranking.length && <p className="chat-muted">{t("client.chat.noTokenDataYet")}</p>}
  </section>;
}
function Consumption({ data, title, fields, hint }: {
  data: TokenSummary; title: string; fields: readonly ConsumptionField[]; hint: string;
}) {
  useLanguage();
  const daily = new Map(data.breakdown.map(day => [day.date, day]));
  return <section className="chat-token-card"><h3>{title}</h3><p className="chat-muted">{hint}</p>
    {data.errors.analytics ? <p className="chat-error">{t("client.chat.couldNotLoadUsagePleaseRefreshToTryAgain")}</p> : <>
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
    <section className="chat-token-card"><h3>{t("client.chat.recent")} {data.weeks}  {t("client.chat.weeksTotalTokens")}</h3>
      <div className="chat-token-metrics">{TOKEN_FIELDS.map(([label, field]) => <div key={field}><small>{t(label)}</small>
        <strong>{formatTokens(data.dailyUsage.reduce((sum, day) => sum + day[field], 0))}</strong></div>)}</div>
      {data.errors.usage && <p className="chat-error">{t("client.chat.someTokenDataCouldNotBeLoadedPleaseRefreshTo")}</p>}
    </section>
    <TokenQuota data={data} />
    <OfficialUsagePanel data={data} />
    <Consumption data={data} title={t("client.chat.shortLongContextUsage")} fields={CONTEXT_FIELDS}
      hint={t("client.chat.requestsWithMoreThanInputTokensIncludingCachedTokensCount", { value1: data.thresholdTokens.toLocaleString(getLocale()) })} />
    <Consumption data={data} title={t("client.chat.standardFastModeUsage")} fields={MODE_FIELDS}
      hint={t("client.chat.dailyTokenTotalsUsageWithoutARecordedModeIsShown")} />
    <section className="chat-token-card"><h3>{t("client.chat.dailyActivity")}</h3><div className="chat-token-heatmap">
      {data.dateKeys.map(date => { const tokens = daily.get(date)?.totalTokens ?? 0;
        return <span key={date} tabIndex={0} title={`${date} · ${formatTokens(tokens)} Token`}
          aria-label={`${date} · ${formatTokens(tokens)} Token`}
          style={{ background: `rgba(20,128,111,${tokens ? .2 + tokens / maximum * .8 : .07})` }} />;
      })}</div></section>
    <section className="chat-token-card"><h3>{t("client.chat.dailyTokenTrend")}</h3>
      <TokenBars labels={TOKEN_FIELDS.map(([label]) => t(label))} points={data.dateKeys.map(date => ({ label: date,
        values: TOKEN_FIELDS.map(([, field]) => daily.get(date)?.[field] ?? 0),
      }))} /></section>
    <Ranking title={t("client.chat.providerUsageRanking")} ranking={data.rankings.providers} count={data.entryCount} />
    <Ranking title={t("client.chat.modelUsageRanking")} ranking={data.rankings.models} count={data.entryCount} />
    <Ranking title={t("client.chat.accountUsageRanking")} ranking={data.rankings.accounts} count={data.entryCount} />
  </>;
}
export function ChatTokenSummary({ read, ready, scope, deviceName, onClose }: {
  read: ReadTokenSummary; ready: boolean; scope: string; deviceName?: string; onClose: () => void;
}) {
  useLanguage();
  const visible = useWindowVisible();
  const summary = useTokenSummary({ read, active: ready && visible, scope });
  const [weeks, setWeeks] = useState('');
  useEffect(() => { setWeeks(String(summary.weeks ?? '')); }, [summary.weeks]);
  return <AdaptiveSheet open title={t("client.chat.tokenSummary")} width={900} onClose={onClose} onBack={onClose}>
    <div className="chat-token-summary chat-scroll"><p className="chat-muted">
      {deviceName || t("client.chatReliability.noComputerSelected")}  {t("client.chat.tokenUsageThroughTheProxyOnly")}</p>
      <form className="chat-row" onSubmit={event => { event.preventDefault(); summary.changeWeeks(Number(weeks)); }}>
        <label htmlFor="chat-summary-weeks">{t("client.chat.recent")}</label><input id="chat-summary-weeks" type="number" min={1} max={52}
          required aria-label={t("client.chat.numberOfWeeks1To52")} value={weeks} onChange={event => setWeeks(event.target.value)} />
        <span className="chat-grow">{t("client.chat.weeks")}</span><button type="submit" className="chat-button">{t("client.chat.apply")}</button>
        <button type="button" className="chat-button" aria-label={t("client.chat.refreshTokenSummary")} disabled={!ready || summary.loading}
          onClick={summary.refresh}>{summary.loading ? t("client.chat.updating") : t("client.chat.refresh")}</button></form>
      {!ready && <p className="chat-muted">{t("client.chat.connectToYourComputerToViewTokenUsage")}</p>}
      {summary.error && <p role="alert" className="chat-error">{displayError(summary.error)}</p>}
      {visible && summary.data && <><p className="chat-muted">{t("client.accounts.updated")} {new Date(summary.data.endTs * 1000).toLocaleTimeString(getLocale())}</p>
        <SummaryContent data={summary.data} /></>}
    </div>
  </AdaptiveSheet>;
}
