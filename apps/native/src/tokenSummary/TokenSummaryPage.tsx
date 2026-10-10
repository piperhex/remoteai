import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { MAX_SUMMARY_WEEKS, MIN_SUMMARY_WEEKS, type ReadTokenSummary } from
  '../../../../shared/remote-chat/tokenSummary';
import { useTokenSummary } from '../../../../shared/remote-chat/client/useTokenSummary';
import { UsageTotals, UsageTrend, RankingPanel } from './UsagePanels';
import { ConsumptionPanels } from './ConsumptionPanels';
import { UsageHeatmap } from './UsageHeatmap';
import { QuotaPanel } from './QuotaPanel';
import { OfficialUsagePanel } from './OfficialUsagePanel';
import { useSummaryStyles as useS } from './styles';

interface Props { read: ReadTokenSummary; ready: boolean; foreground: boolean; deviceName?: string; onBack: () => void }

export function TokenSummaryPage({ read, ready, foreground, deviceName, onBack }: Props) {
  const s = useS();
  const color = useThemeColor();
  useLanguage();
  const summary = useTokenSummary({ read, active: ready && foreground });
  const { data, loading, error } = summary;
  const [draftWeeks, setDraftWeeks] = useState('');
  useEffect(() => { setDraftWeeks(summary.weeks?.toString() ?? ''); }, [summary.weeks]);
  const applyWeeks = () => {
    const value = Number(draftWeeks);
    if (!Number.isInteger(value) || value < MIN_SUMMARY_WEEKS || value > MAX_SUMMARY_WEEKS) {
      setDraftWeeks(summary.weeks?.toString() ?? ''); return;
    }
    if (value !== summary.weeks) summary.changeWeeks(value);
  };
  return <View style={s.page}>
    <View style={s.header}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("返回聊天")} style={s.button} onPress={onBack}>
        <Feather name="arrow-left" size={24} color={color("#17211b", 'ink')} />
      </Pressable><Text accessibilityRole="header" style={[s.title, s.fill]}>{t("Token 汇总")}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t("刷新 Token 汇总")} style={s.button}
        disabled={!ready || loading} onPress={summary.refresh}>
        {loading ? <ActivityIndicator color={color("#0b8065", 'accent')} /> : <Feather name="refresh-cw" size={20} color={color("#0b8065", 'accent')} />}
      </Pressable>
    </View>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={summary.refresh} enabled={ready}
        tintColor={color("#0b8065", 'accent')} colors={['#0b8065']} />}>
      <View style={{ gap: 8 }}><Text style={s.hint}>{deviceName || t("尚未选择电脑")}{' '}{t("· 仅统计代理模式的 Token 消耗")}</Text>
        <View style={s.row}><Text style={s.hint}>{t("最近")}</Text>
          <TextInput accessibilityLabel={t("统计周数，1 至 52 周")} style={s.input} value={draftWeeks}
            keyboardType="number-pad" maxLength={2} onChangeText={setDraftWeeks}
            onEndEditing={applyWeeks} onSubmitEditing={applyWeeks} returnKeyType="done" />
          <Text style={[s.hint, s.fill]}>{t("周")}</Text>
          <Pressable accessibilityRole="button" style={s.button} onPress={applyWeeks}>
            <Text style={s.action}>{t("应用")}</Text></Pressable>
        </View>
        {data && <Text style={s.hint}>{t("更新于")}{' '}{new Date(data.endTs * 1000).toLocaleTimeString()}</Text>}
      </View>
      {!ready && <Text style={s.error}>{t("连接电脑后即可查看 Token 汇总。")}</Text>}
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      {loading && !data && <Text style={s.hint}>{t("正在加载汇总…")}</Text>}
      {data && <>
        <UsageTotals data={data} />
        <QuotaPanel data={data} />
        <OfficialUsagePanel data={data} />
        <ConsumptionPanels data={data} />
        <UsageHeatmap data={data} />
        <UsageTrend data={data} />
        <RankingPanel title={t("Provider 消耗排行")} ranking={data.rankings.providers} count={data.entryCount} />
        <RankingPanel title={t("模型消耗排行")} ranking={data.rankings.models} count={data.entryCount} />
        <RankingPanel title={t("账户消耗排行")} ranking={data.rankings.accounts} count={data.entryCount} />
      </>}
    </ScrollView>
  </View>;
}
