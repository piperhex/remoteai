import { useThemeMode } from '../theme/store';
import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { TokenSummary } from '../../../../shared/remote-chat/tokenSummary';
import { chartPalette, formatTokens } from '../../../desktop/src/components/TokenUsageDashboard/chartUtils';
import { TOKEN_FIELDS } from './UsagePanels';
import { useSummaryStyles as useS } from './styles';

const DAYS_PER_WEEK = 7;
const HEAT_STEP = 25_000_000;


export function UsageHeatmap({ data }: { data: TokenSummary }) {
  const mode = useThemeMode();
  const heat = chartPalette(mode === 'dark' ? '#61d6ad' : '#0b8065', mode === 'dark').heat;
  const s = useS();
  const h = useH();
  const language = useLanguage();
  const [selected, setSelected] = useState<string>();
  const daily = new Map(data.dailyUsage.map((day) => [day.date, day]));
  const weeks = Array.from({ length: Math.ceil(data.dateKeys.length / DAYS_PER_WEEK) }, (_, index) =>
    data.dateKeys.slice(index * DAYS_PER_WEEK, (index + 1) * DAYS_PER_WEEK));
  return <View style={s.card}><Text style={s.sectionTitle}>{t("每日 Token 热力图")}</Text>
    <Text style={s.hint}>{t("颜色越深，消耗越多。左右滑动查看，点按日期查看详情。")}</Text>
    <View style={s.row}><View>{[t("日"), t("一"), t("二"), t("三"), t("四"), t("五"), t("六")].map((day) =>
      <Text key={day} style={h.weekday}>{day}</Text>)}</View>
      <ScrollView horizontal style={s.fill} contentContainerStyle={{ gap: 3 }}>
        {weeks.map((week) => <View key={week[0]} style={{ gap: 3 }}>{week.map((date) => {
          const total = daily.get(date)?.totalTokens ?? 0;
          const level = total <= 0 ? 0 : Math.min(4, Math.ceil(total / HEAT_STEP));
          return <Pressable key={date} accessibilityRole="button" accessibilityState={{ selected: selected === date }}
            accessibilityLabel={`${date}，${formatTokens(total, language)} Tokens`} onPress={() => setSelected(date)}
            style={[h.cell, { backgroundColor: heat[level] }, selected === date && h.selected]} />;
        })}</View>)}
      </ScrollView></View>
    <View style={s.row}><Text style={[s.hint, s.fill]}>{data.dateKeys[0]} — {data.dateKeys.at(-1)}</Text></View>
    <View style={s.row}><Text style={s.hint}>{t("少")}</Text>{heat.map((color) =>
      <View key={color} style={[h.legend, { backgroundColor: color }]} />)}<Text style={s.hint}>{t("多")}</Text></View>
    {selected && <View style={s.detail} accessibilityLiveRegion="polite"><Text style={s.value}>{selected}</Text>
      {TOKEN_FIELDS.map(([label, field]) => <Text key={field} style={s.hint}>
        {t(label)}: {formatTokens(daily.get(selected)?.[field] ?? 0, language)}</Text>)}
    </View>}
  </View>;
}

const useH = createThemedStyles((color) => ({
  weekday: { height: 27, lineHeight: 24, fontSize: 11, color: color('#718078', 'muted') },
  cell: { width: 24, height: 24, borderRadius: 4 },
  selected: { borderWidth: 2, borderColor: color('#17211b', 'border') },
  legend: { width: 12, height: 12, borderRadius: 2 },
}));
