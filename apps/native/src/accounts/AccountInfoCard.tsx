import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { AccountSummary } from '../types';
import { earliestExpirationDate } from '../utils/expiration';
import { copyAccountValue } from './copyAccountValue';
import { detailColors as colors, useDetailStyles as useStyles } from './detailStyles';
import { useAccountTotp } from './useAccountTotp';
import type { ResetCreditsState } from './useResetCredits';

function InfoRow({ label, value, secret = false, copy = false }: {
  label: string; value?: string | null; secret?: boolean; copy?: boolean;
}) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const [revealed, setRevealed] = useState(false);
  const hidden = secret && !revealed;
  const text = value ? (hidden ? '••••••••' : value) : t("未设置");
  return <View style={styles.row}>
    <Text style={styles.label}>{label}</Text>
    <Text selectable={!hidden} style={[styles.value, !value && styles.emptyValue]}>{text}</Text>
    {secret && value ? <Pressable accessibilityRole="button"
      accessibilityLabel={`${hidden ? t("显示") : t("隐藏")}${label}`} onPress={() => setRevealed(!revealed)}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
      <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={17} color={color(colors.muted, 'muted')} />
    </Pressable> : null}
    {copy && value ? <Pressable accessibilityRole="button" accessibilityLabel={t("复制{value1}", { value1: label })}
      onPress={() => void copyAccountValue(label, value)}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
      <Ionicons name="copy-outline" size={17} color={color(colors.muted, 'muted')} />
    </Pressable> : null}
  </View>;
}

function TotpRow({ secret, active }: { secret: string; active: boolean }) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const totp = useAccountTotp(active ? secret : '');
  return <View style={styles.row}>
    <Text style={styles.label}>2FA</Text>
    <View style={styles.spacer}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("复制当前验证码")} disabled={!totp}
        onPress={() => { if (totp) void copyAccountValue(t("验证码"), totp.code); }} style={styles.codeButton}>
        <Text style={totp ? styles.code : styles.emptyCode}>
          {secret ? (totp?.code ?? t("暂不可用")) : t("未设置")}
        </Text>
        {totp ? <Ionicons name="copy-outline" size={17} color={color(colors.muted, 'muted')} /> : null}
      </Pressable>
    </View>
    {totp ? <Text style={styles.countdown}>{totp.remaining}{' '}{t("秒")}</Text> : null}
  </View>;
}

function CreditsRow({ credits, onPress }: { credits: ResetCreditsState; onPress: () => void }) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const count = credits.summary?.credits.length;
  return <Pressable accessibilityRole="button" accessibilityLabel={t("查看重置卡详情")} onPress={onPress}
    style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
    <Text style={styles.label}>{t("重置卡")}</Text>
    {credits.loading ? <View style={styles.value}><ActivityIndicator size="small" color={color(colors.green, 'accent')} /></View>
      : <Text style={styles.value}>{count === undefined ? t("暂不可用") : t("{value1} 张", { value1: count })}</Text>}
    <Ionicons name="chevron-forward" size={16} color={color(colors.muted, 'muted')} />
  </Pressable>;
}

export function AccountInfoCard({ account, credits, active, onEdit, onNote, onCredits }: {
  account: AccountSummary;
  credits: ResetCreditsState;
  active: boolean;
  onEdit: () => void;
  onNote: () => void;
  onCredits: () => void;
}) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const details = account.privateDetails;
  const expiration = earliestExpirationDate(account.expiresAt, account.usage.apiExpiresAt);
  return <View style={styles.section}>
    <View style={styles.heading}>
      <View style={styles.sectionIcon}><Ionicons name="person" size={17} color={color(colors.muted, 'muted')} /></View>
      <Text style={styles.title}>{t("账号信息")}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t("编辑账号信息")} onPress={onEdit}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
        <Ionicons name="create-outline" size={21} color={color(colors.green, 'accent')} />
      </Pressable>
    </View>
    <InfoRow label={t("套餐")} value={account.plan || 'ChatGPT'} />
    <InfoRow label={t("到期时间")} value={expiration} />
    {account.expiresAt && expiration !== account.expiresAt
      ? <InfoRow label={t("预设截止")} value={account.expiresAt} /> : null}
    <InfoRow label={t("账号 ID")} value={account.accountId} copy />
    <InfoRow label={t("手机号")} value={details?.phoneNumber} copy />
    <InfoRow label={t("密码")} value={details?.password} secret copy />
    <TotpRow secret={details?.totpSecret ?? ''} active={active} />
    <Pressable accessibilityRole="button" accessibilityLabel={t("查看完整备注")} onPress={onNote}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Text style={styles.label}>{t("备注")}</Text>
      <Text style={styles.value} numberOfLines={1} ellipsizeMode="tail">{account.note || t("未设置")}</Text>
      <Ionicons name="chevron-forward" size={16} color={color(colors.muted, 'muted')} />
    </Pressable>
    <CreditsRow credits={credits} onPress={onCredits} />
  </View>;
}
