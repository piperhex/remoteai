import { t, useLanguage } from '../i18n';
import { Text, View } from 'react-native';
import type { TokenSummary, UsageRanking } from '../../../../shared/remote-chat/tokenSummary';
import { formatTokens } from '../../../desktop/src/components/TokenUsageDashboard/chartUtils';
import { TimeBars } from './TimeBars';
import { useSummaryStyles as useS } from './styles';

export const TOKEN_FIELDS = [
  ['总计', 'totalTokens'], ['输入', 'inputTokens'], ['输出', 'outputTokens'],
  ['推理', 'reasoningTokens'], ['缓存', 'cachedTokens'],
] as const;

export function UsageTotals({ data }: { data: TokenSummary }) {
  const s = useS();
  const language = useLanguage();
  return <View style={s.card}>
    <Text style={s.hint}>{t("最近")}{' '}{data.weeks}{' '}{t("周 · Token 总消耗")}</Text>
    <Text style={s.number}>{formatTokens(data.dailyUsage.reduce((sum, day) => sum + day.totalTokens, 0), language)}</Text>
    <Text style={s.sectionTitle}>{t("Token 类型累计")}</Text>
    <View style={s.wrap}>{TOKEN_FIELDS.slice(1).map(([label, field]) => <View key={field} style={s.metric}>
      <Text style={s.hint}>{t(label)}</Text>
      <Text style={s.value}>{formatTokens(data.dailyUsage.reduce((sum, day) => sum + day[field], 0), language)}</Text>
    </View>)}</View>
    {data.errors.usage && <Text style={s.error}>{t("部分 Token 数据加载失败，请刷新重试。")}</Text>}
  </View>;
}

export function UsageTrend({ data }: { data: TokenSummary }) {
  const s = useS();
  const language = useLanguage();
  const daily = new Map(data.dailyUsage.map((day) => [day.date, day]));
  return <View style={s.card}><Text style={s.sectionTitle}>{t("每日 Token 趋势")}</Text>
    <TimeBars labels={TOKEN_FIELDS.map(([label]) => t(label))} points={data.dateKeys.map((date) => ({
      label: date, values: TOKEN_FIELDS.map(([, field]) => daily.get(date)?.[field] ?? 0),
    }))} />
  </View>;
}

export function RankingPanel({ title, ranking, count }: { title: string; ranking: UsageRanking; count: number }) {
  const s = useS();
  const language = useLanguage();
  const total = ranking.reduce((sum, [, tokens]) => sum + tokens, 0);
  const maximum = Math.max(1, ...ranking.map(([, tokens]) => tokens));
  return <View style={s.card}><Text style={s.sectionTitle}>{title}</Text>
    <Text style={s.hint}>{t("基于最近")}{' '}{count}{' '}{t("条代理请求 · 前 8 名")}</Text>
    {ranking.map(([name, tokens], index) => <View key={name} style={{ gap: 6 }}>
      <Text selectable style={s.hint}>{index + 1}. {name}</Text>
      <View style={s.row}><Text style={[s.value, s.fill]}>{formatTokens(tokens, language)}</Text>
        <Text style={s.hint}>{total ? (tokens / total * 100).toFixed(1) : '0.0'}%</Text></View>
      <View style={s.barTrack}><View style={[s.bar, { width: `${tokens / maximum * 100}%` }]} /></View>
    </View>)}
    {!ranking.length && <Text style={s.hint}>{t("暂无 Token 数据")}</Text>}
  </View>;
}
