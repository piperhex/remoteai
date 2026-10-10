import type { ThemeColor } from '../../../../shared/theme/mode';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import type { AccountSummary, UsageWindow } from '../types';
import { maskEmail, resetLabel } from './formatters';
import { accountColors as colors, useStyles } from './styles';

interface AccountCardProps {
  account: AccountSummary;
  privateMode: boolean;
  onOpenDetails: (account: AccountSummary) => void;
}

function planColors(plan: string, color: ThemeColor) {
  switch (plan.trim().toLowerCase()) {
    case 'plus': return { ink: color(colors.blue, 'info'), background: color(colors.paleBlue, 'infoSoft'), fill: '#48b7ff' };
    case 'free': return { ink: color(colors.orange, 'warning'), background: color(colors.paleOrange, 'warningSoft'), fill: '#2aceac' };
    default: return { ink: color(colors.green, 'accent'), background: color(colors.mint, 'accentSoft'), fill: '#2aceac' };
  }
}

const CRITICAL_QUOTA_PERCENT = 15;
const LOW_QUOTA_PERCENT = 40;

function usageAppearance(remaining: number | null, plan: string, color: ThemeColor) {
  const plus = plan.trim().toLowerCase() === 'plus';
  let fill = planColors(plan, color).fill;
  let textColor = plus ? color(colors.blue, 'info') : color(colors.green, 'accent');
  if (remaining !== null && remaining <= LOW_QUOTA_PERCENT) {
    fill = remaining <= CRITICAL_QUOTA_PERCENT ? colors.danger : colors.warning;
    textColor = color(fill, remaining <= CRITICAL_QUOTA_PERCENT ? 'danger' : 'warning');
  }
  const endColor = plus || (remaining !== null && remaining <= LOW_QUOTA_PERCENT) ? fill : '#63e7c7';
  return { fill, textColor, gradient: `linear-gradient(90deg, ${fill} 0%, ${endColor} 100%)` };
}

function AccountUsage({ usage, plan }: { usage?: UsageWindow | null; plan: string }) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const remaining = usage && Number.isFinite(usage.remainingPercent)
    ? Math.max(0, Math.min(100, Math.round(usage.remainingPercent))) : null;
  const { fill, textColor, gradient } = usageAppearance(remaining, plan, color);
  return <View style={styles.usage}>
    <View style={styles.meter}>
      <View style={styles.track} accessibilityRole="progressbar"
        accessibilityLabel={t("剩余额度")} accessibilityValue={remaining === null
          ? { text: t("用量暂不可用") } : { min: 0, max: 100, now: remaining }}>
        {remaining !== null ? <View style={[styles.fill, {
          width: `${remaining}%`, backgroundColor: fill,
          experimental_backgroundImage: gradient,
        }]} /> : null}
      </View>
      <Text style={[styles.remaining, { color: remaining === null ? color(colors.muted, 'muted') : textColor }]}>
        {remaining === null ? '--' : `${remaining}%`}
      </Text>
    </View>
    <View style={styles.reset}>
      <Ionicons name="time-outline" size={15} color={color(colors.muted, 'muted')} />
      <Text style={styles.resetText}>{remaining === null ? t("用量暂不可用") : resetLabel(usage?.resetsAt)}</Text>
    </View>
  </View>;
}

export function AccountCard({ account, privateMode, onOpenDetails }: AccountCardProps) {
  const color = useThemeColor();
  const styles = useStyles();
  useLanguage();
  const email = privateMode ? maskEmail(account.email) : account.email;
  const plan = account.plan || 'ChatGPT';
  const accent = planColors(plan, color);
  return <Pressable accessibilityRole="button" accessibilityLabel={t("{value1} 的账号信息", { value1: email })}
    accessibilityHint={t("打开完整账号信息")} onPress={() => onOpenDetails(account)}
    style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
    <View style={styles.cardContent}>
      <View style={styles.identity}>
        <View style={[styles.badge, { backgroundColor: accent.background }]}>
          <Text style={[styles.plan, { color: accent.ink }]} numberOfLines={1}>{plan}</Text>
        </View>
        <Text style={styles.email} numberOfLines={1}>{email}</Text>
      </View>
      <AccountUsage usage={account.usage.primary} plan={plan} />
    </View>
  </Pressable>;
}
