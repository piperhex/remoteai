import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { Toast } from '../components/AppToast';
import { TotpOptionsMenu } from './TotpOptionsMenu';
import { TotpServiceIcon } from './TotpServiceIcon';
import { useTotpStyles as useStyles } from './styles';
import type { TotpEntry } from './types';

interface TotpCodeCardProps {
  code: string;
  entry: TotpEntry;
  now: number;
  onCopied: () => void;
  onDelete: () => void;
  onEdit: () => void;
}

const COMPACT_CARD_SCREEN_WIDTH = 360;

function displayCode(code: string) {
  const splitAt = code.length / 2;
  return `${code.slice(0, splitAt)} ${code.slice(splitAt)}`;
}

export function TotpCodeCard({ code, entry, now, onCopied, onDelete, onEdit }: TotpCodeCardProps) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const compact = useWindowDimensions().width < COMPACT_CARD_SCREEN_WIDTH;
  const elapsed = Math.floor(now / 1000) % entry.period;
  const remaining = entry.period - elapsed;
  const progress = `${(remaining / entry.period) * 100}%` as `${number}%`;
  const copy = async () => {
    if (!code) return;
    try {
      await Clipboard.setStringAsync(code);
      onCopied();
    } catch {
      Toast.fail(t('复制失败，请重试'));
    }
  };
  return <View style={styles.codeCard}>
    <View style={styles.codeHeader}>
      <TotpServiceIcon issuer={entry.issuer} />
      <View style={styles.codeIdentity}>
        <Text style={styles.issuer} numberOfLines={1}>{entry.issuer}</Text>
        <Text style={styles.account} numberOfLines={1}>{entry.accountName}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t("管理 {value1} 的 2FA 密钥", { value1: entry.issuer })}
        style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]} onPress={() => setMenuOpen(true)}>
        <Ionicons name="ellipsis-horizontal" size={21} color={color("#838b99", 'muted')} />
      </Pressable>
    </View>
    <View style={[styles.codeBody, compact && styles.compactCodeBody]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("复制 {value1} 验证码", { value1: entry.issuer })}
        disabled={!code} style={styles.codeButton} onPress={() => void copy()}>
        <View style={styles.codeRow}>
          <Text style={styles.codeValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
            {displayCode(code)}
          </Text>
          <Text style={styles.countdown}>{remaining}{' '}{t("秒")}</Text>
        </View>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: progress }]} /></View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t("复制 {value1} 验证码到剪贴板", { value1: entry.issuer })}
        disabled={!code} onPress={() => void copy()}
        style={({ pressed }) => [styles.copyButton, compact && styles.compactCopyButton, pressed && styles.pressed]}>
        <Ionicons name="copy-outline" size={21} color={color("#008956", 'accent')} />
        {!compact && <Text style={styles.copyText}>{t("复制")}</Text>}
      </Pressable>
    </View>
    <TotpOptionsMenu title={entry.issuer} visible={menuOpen} onClose={() => setMenuOpen(false)} options={[
      { label: t("编辑密钥"), icon: 'create-outline', onPress: onEdit },
      { label: t("删除密钥"), icon: 'trash-outline', onPress: onDelete, danger: true },
    ]} />
  </View>;
}
