import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { accountColors as colors, useStyles } from './styles';

interface AccountOverviewProps {
  accountCount: number;
  onlineDeviceCount: number;
  refreshBusy: boolean;
  refreshingUsage: boolean;
  consumingQuota: boolean;
  canConsumeQuota: boolean;
  privateMode: boolean;
  onTogglePrivacy: () => void;
  onRefreshUsage: () => void;
  onConsumeQuota: () => void;
}

function OverviewStat({ value, label, icon }: {
  value: number;
  label: string;
  icon: 'people' | 'laptop-outline';
}) {
  const resolveThemeColor = useThemeColor();
  const styles = useStyles();
  useLanguage();
  const { width, fontScale } = useWindowDimensions();
  const narrow = width / fontScale < 380;
  return <View style={[styles.stat, narrow && styles.statNarrow]}>
    <Ionicons name={icon} size={24} color={icon === 'people' ? resolveThemeColor(colors.green, 'accent') : resolveThemeColor(colors.muted, 'muted')} />
    <View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  </View>;
}

function OverviewActions(props: AccountOverviewProps) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const refreshDisabled = props.refreshBusy || props.accountCount === 0;
  const consumeDisabled = props.refreshBusy || !props.canConsumeQuota;
  return <View style={styles.actions}>
    <Pressable accessibilityRole="button" accessibilityLabel={t("消耗额度")} disabled={consumeDisabled}
      onPress={props.onConsumeQuota}
      style={({ pressed }) => [styles.action, styles.consume,
        pressed && styles.pressed, consumeDisabled && styles.disabled]}>
      {props.consumingQuota ? <ActivityIndicator color={color(colors.green, 'accent')} size="small" /> : <>
        <Ionicons name="flash" size={24} color={color("#ffc400", 'warning')} />
        <Text style={styles.consumeText}>{t("消耗额度")}</Text>
      </>}
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={t("批量刷新用量")} disabled={refreshDisabled}
      onPress={props.onRefreshUsage}
      style={({ pressed }) => [styles.action, styles.refresh,
        pressed && styles.pressed, refreshDisabled && styles.disabled]}>
      {props.refreshingUsage ? <ActivityIndicator color="#fff" size="small" /> : <>
        <Ionicons name="sync-outline" size={18} color="#fff" />
        <Text style={styles.refreshText}>{t("批量刷新用量")}</Text>
      </>}
    </Pressable>
  </View>;
}

export function AccountOverview(props: AccountOverviewProps) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  return <View style={styles.overview}>
    <View style={styles.headingRow}>
      <Text style={styles.heading}>{t("账户管理")}</Text>
      <Pressable accessibilityRole="button" onPress={props.onTogglePrivacy}
        accessibilityLabel={props.privateMode ? t("显示账号邮箱") : t("隐藏账号邮箱")}
        style={({ pressed }) => [styles.privacyButton, pressed && styles.pressed]}>
        <Ionicons name={props.privateMode ? 'eye-off-outline' : 'eye-outline'} size={18} color={color(colors.muted, 'muted')} />
      </Pressable>
    </View>
    <View style={styles.overviewRow}>
      <OverviewStat value={props.accountCount} label={t("个账号")} icon="people" />
      <OverviewStat value={props.onlineDeviceCount} label={t("在线设备")} icon="laptop-outline" />
      <OverviewActions {...props} />
    </View>
  </View>;
}

export function AccountToolbar({ updatedAt, onAddAccount }: { updatedAt: string; onAddAccount: () => void }) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  return <View style={styles.toolbar}>
    <View style={styles.updated}>
      <Ionicons name="time-outline" size={16} color={color(colors.muted, 'muted')} />
      <Text style={styles.updatedText}>{t("用量更新：")}{updatedAt}</Text>
    </View>
    <Pressable accessibilityRole="button" onPress={onAddAccount}
      style={({ pressed }) => [styles.add, pressed && styles.pressed]}>
      <Ionicons name="add" size={22} color={color(colors.green, 'accent')} />
      <Text style={styles.addText}>{t("添加账户")}</Text>
    </Pressable>
  </View>;
}
