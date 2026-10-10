import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { formatTokens } from '../../../desktop/src/components/TokenUsageDashboard/chartUtils';
import { chartColors, useSummaryStyles as useS } from './styles';

export interface TimeBarPoint { key?: string; label: string; values: Array<number | null> }
interface Props { points: TimeBarPoint[]; labels: string[]; unit?: '%' | 'points' }
const COLUMN_WIDTH = 44;
const CHART_HEIGHT = 120;
const VISIBLE_COLUMNS = 6;

/** Virtualized columns keep long hourly histories responsive on phones. */
export function TimeBars({ points, labels, unit }: Props) {
  const s = useS();
  const bars = useBars();
  const language = useLanguage();
  const [selected, setSelected] = useState<number | null>(null);
  const [series, setSeries] = useState(0);
  const maximum = Math.max(1, ...points.map((point) => point.values[series] ?? 0));
  const format = (value: number | null) => value === null ? t("暂无记录")
    : unit ? `${value.toFixed(2)}${unit === 'points' ? t('百分点') : unit}` : formatTokens(value, language);
  const current = selected === null ? undefined : points[selected];
  return <View style={{ gap: 10 }}>
    <View style={s.wrap}>{labels.map((label, index) => <Pressable key={label} accessibilityRole="button"
      accessibilityState={{ selected: series === index }} onPress={() => setSeries(index)}
      style={[s.chip, series === index && s.selected]}><Text style={s.action}>{label}</Text></Pressable>)}</View>
    <Text style={s.hint}>{t("刻度上限")}{' '}{format(maximum)}{' '}{t("· 左右滑动，点按查看详情")}</Text>
    <FlatList horizontal data={points} style={bars.chart} initialNumToRender={12} windowSize={3}
      initialScrollIndex={Math.max(0, points.length - VISIBLE_COLUMNS)}
      getItemLayout={(_, index) => ({ length: COLUMN_WIDTH, offset: COLUMN_WIDTH * index, index })}
      keyExtractor={(point) => point.key ?? point.label} extraData={`${series}:${selected}:${maximum}:${language}`}
      renderItem={({ item, index }) => <Pressable style={bars.column} accessibilityRole="button"
        accessibilityLabel={`${item.label}，${labels[series]} ${format(item.values[series])}`}
        accessibilityState={{ selected: index === selected }} onPress={() => setSelected(index)}>
        <View style={[bars.track, index === selected && s.selected]}>
          {item.values[series] !== null && <View style={{ width: 18, borderRadius: 3,
            height: Math.max(2, (item.values[series] ?? 0) / maximum * CHART_HEIGHT),
            backgroundColor: chartColors[series % chartColors.length] }} />}
        </View><Text numberOfLines={2} style={bars.label}>{item.label.slice(5).replace(' ', '\n')}</Text>
      </Pressable>} />
    {current && <View style={s.detail} accessibilityLiveRegion="polite">
      <Text style={s.value}>{current.label}</Text>
      {labels.map((label, index) => <Text key={label} style={s.hint}>
        {label}：{format(current.values[index])}</Text>)}
    </View>}
  </View>;
}

const useBars = createThemedStyles((color) => ({
  chart: { height: 166, flexGrow: 0 },
  column: { width: COLUMN_WIDTH, alignItems: 'center' },
  track: { height: CHART_HEIGHT + 6, width: 32, alignItems: 'center', justifyContent: 'flex-end',
    borderBottomWidth: 1, borderColor: color('#dfe5df', 'border') },
  label: { color: color('#718078', 'muted'), fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 5 },
}));
