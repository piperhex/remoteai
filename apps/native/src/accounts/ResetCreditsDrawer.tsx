import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { consumeResetCredit } from '../api/client';
import { BottomSheet } from '../components/BottomSheet';
import { Toast } from '../components/AppToast';
import type { AccountSummary } from '../types';
import { displayFullDate, maskEmail } from './formatters';
import type { ResetCreditsState } from './useResetCredits';

const COLORS = { ink: '#111827', muted: '#738091', border: '#e6ebef', canvas: '#f7faf9',
  paleBlue: '#e8f8fb', paleGreen: '#e6f8f1', green: '#00aa96', danger: '#d95454' };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : t("请稍后重试");
}

export function ResetCreditsDrawer({ account, visible, privateMode, credits: creditState, onClose, onConsumed }: {
  account: AccountSummary;
  visible: boolean;
  privateMode: boolean;
  credits: ResetCreditsState;
  onClose: () => void;
  onConsumed: () => Promise<void>;
}) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const [consuming, setConsuming] = useState(false);
  const { summary, loading, error, reload: loadCredits } = creditState;

  const useCredit = useCallback(async () => {
    if (consuming) return;
    setConsuming(true);
    try {
      await consumeResetCredit(account);
      Toast.success(t("重置卡使用成功"));
      await Promise.all([loadCredits(), onConsumed()]);
    } catch (nextError) {
      Toast.fail(t("使用失败：{value1}", { value1: errorMessage(nextError) }));
    } finally {
      setConsuming(false);
    }
  }, [account, consuming, loadCredits, onConsumed]);

  const confirmUseCredit = useCallback(() => {
    if (!summary?.credits.length || consuming) return;
    Alert.alert(
      t("确认使用重置卡？"),
      t("使用一张重置卡，恢复当前可重置的用量额度。"),
      [
        { text: t("取消"), style: 'cancel' },
        { text: t("使用重置卡"), style: 'destructive', onPress: () => void useCredit() },
      ],
    );
  }, [consuming, summary?.credits.length, useCredit]);

  const credits = summary?.credits ?? [];
  return <BottomSheet
    visible={visible}
    title={t("重置卡详情")}
    subtitle={privateMode ? maskEmail(account.email) : account.email}
    onClose={onClose}
    onBack={onClose}
    dismissible={!consuming}
    dragFromHeaderOnly
    actions={[
      { label: t("关闭"), onPress: onClose, disabled: consuming },
      {
        label: t("使用重置卡"),
        tone: 'primary',
        onPress: confirmUseCredit,
        loading: consuming,
        disabled: loading || Boolean(error) || credits.length === 0,
      },
    ]}
  >
    <View style={styles.resetCreditSummary}>
      <View>
        <Text style={styles.resetCreditSummaryLabel}>{t("当前可用")}</Text>
        <Text style={styles.resetCreditSummaryHint}>{t("使用前会再次确认可用数量")}</Text>
      </View>
      <Text style={styles.resetCreditCount}>{loading || error ? '—' : credits.length}
        <Text style={styles.resetCreditCountUnit}>{' '}{t("张")}</Text>
      </Text>
    </View>

    <ScrollView
      style={styles.resetCreditsScroll}
      contentContainerStyle={styles.resetCreditsScrollContent}
      showsVerticalScrollIndicator={false}
    >
      {loading ? <View style={styles.resetCreditStatus}>
        <ActivityIndicator color={color(COLORS.green, 'accent')} />
        <Text style={styles.resetCreditStatusText}>{t("正在读取重置卡…")}</Text>
      </View> : error ? <View style={styles.resetCreditStatus}>
        <Text style={styles.resetCreditErrorTitle}>{t("读取失败")}</Text>
        <Text style={styles.resetCreditStatusText}>{error}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void loadCredits()}
          style={({ pressed }) => [styles.resetCreditRetry, pressed && styles.pressed]}
        >
          <Text style={styles.resetCreditRetryText}>{t("重新读取")}</Text>
        </Pressable>
      </View> : credits.length === 0 ? <View style={styles.resetCreditStatus}>
        <Text style={styles.resetCreditEmptyIcon}>✓</Text>
        <Text style={styles.resetCreditEmptyTitle}>{t("当前没有可用重置卡")}</Text>
        <Text style={styles.resetCreditStatusText}>{t("获得新的重置卡后，可在这里查看和使用。")}</Text>
      </View> : credits.map((credit, index) => <View
        key={`${credit.issuedAt ?? 'unknown'}-${credit.expiresAt ?? 'unknown'}-${index}`}
        style={styles.resetCreditCard}
      >
        <View style={styles.resetCreditCardHeader}>
          <View style={styles.resetCreditCardIcon}><Text style={styles.resetCreditCardIconText}>↻</Text></View>
          <Text style={styles.resetCreditCardTitle}>{t("重置卡")}{' '}{index + 1}</Text>
          <View style={styles.resetCreditAvailableBadge}><Text style={styles.resetCreditAvailableText}>{t("可用")}</Text></View>
        </View>
        <View style={styles.resetCreditTimeRow}>
          <Text style={styles.resetCreditTimeLabel}>{t("发放时间")}</Text>
          <Text style={styles.resetCreditTimeValue}>{displayFullDate(credit.issuedAt)}</Text>
        </View>
        <View style={styles.resetCreditTimeDivider} />
        <View style={styles.resetCreditTimeRow}>
          <Text style={styles.resetCreditTimeLabel}>{t("到期时间")}</Text>
          <Text style={styles.resetCreditTimeValue}>{displayFullDate(credit.expiresAt)}</Text>
        </View>
      </View>)}
    </ScrollView>
  </BottomSheet>;
}

const useStyles = createThemedStyles((color) => ({
  resetCreditSummary: {
    minHeight: 76, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14,
    borderRadius: 15, backgroundColor: color(COLORS.paleBlue, 'infoSoft'), paddingHorizontal: 16, paddingVertical: 13,
  },
  resetCreditSummaryLabel: { color: color(COLORS.ink, 'ink'), fontSize: 14, fontWeight: '800' },
  resetCreditSummaryHint: { color: color(COLORS.muted, 'muted'), fontSize: 10, lineHeight: 15, marginTop: 4 },
  resetCreditCount: { color: color('#148da3', 'info'), fontSize: 26, fontWeight: '900' },
  resetCreditCountUnit: { color: color(COLORS.muted, 'muted'), fontSize: 12, fontWeight: '700' },
  resetCreditsScroll: { maxHeight: 390, marginTop: 12 },
  resetCreditsScrollContent: { paddingBottom: 4 },
  resetCreditStatus: {
    minHeight: 190, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color(COLORS.border, 'border'),
    borderRadius: 15, backgroundColor: color(COLORS.canvas, 'canvas'), padding: 22,
  },
  resetCreditStatusText: { color: color(COLORS.muted, 'muted'), fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8 },
  resetCreditErrorTitle: { color: color(COLORS.danger, 'danger'), fontSize: 16, fontWeight: '800' },
  resetCreditRetry: {
    minWidth: 94, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 10,
    backgroundColor: color(COLORS.paleBlue, 'infoSoft'), marginTop: 15, paddingHorizontal: 14,
  },
  resetCreditRetryText: { color: color('#168da2', 'info'), fontSize: 13, fontWeight: '800' },
  resetCreditEmptyIcon: {
    width: 42, height: 42, borderRadius: 21, color: color('#14806f', 'accent'), backgroundColor: color('#d8f4ec', 'accentSoft'), fontSize: 23,
    lineHeight: 42, fontWeight: '900', textAlign: 'center', overflow: 'hidden',
  },
  resetCreditEmptyTitle: { color: color(COLORS.ink, 'ink'), fontSize: 15, fontWeight: '800', marginTop: 12 },
  resetCreditCard: {
    borderWidth: 1, borderColor: color(COLORS.border, 'border'), borderRadius: 15, backgroundColor: color('#fff', 'surface'), padding: 15,
    marginBottom: 10,
  },
  resetCreditCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 13 },
  resetCreditCardIcon: {
    width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color(COLORS.paleBlue, 'infoSoft'), marginRight: 10,
  },
  resetCreditCardIconText: { color: color('#168da2', 'info'), fontSize: 19, lineHeight: 22, fontWeight: '800' },
  resetCreditCardTitle: { flex: 1, color: color(COLORS.ink, 'ink'), fontSize: 14, fontWeight: '800' },
  resetCreditAvailableBadge: {
    borderRadius: 7, backgroundColor: color(COLORS.paleGreen, 'accentSoft'), paddingHorizontal: 8, paddingVertical: 4,
  },
  resetCreditAvailableText: { color: color('#14806f', 'accent'), fontSize: 10, fontWeight: '800' },
  resetCreditTimeRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 14 },
  resetCreditTimeLabel: { width: 58, color: color(COLORS.muted, 'muted'), fontSize: 11 },
  resetCreditTimeValue: { flex: 1, color: color(COLORS.ink, 'ink'), fontSize: 12, fontWeight: '700', textAlign: 'right' },
  resetCreditTimeDivider: { height: 1, backgroundColor: color('#eef3ef', 'canvas') },
  pressed: { opacity: 0.7 },
}));
