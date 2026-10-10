import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { useState } from 'react';
import { ActivityIndicator, Switch, Text, View } from 'react-native';
import type { TotpManagerState } from './types';

export function TotpSyncSettings({ manager }: { manager: TotpManagerState }) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const [changing, setChanging] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const change = async (enabled: boolean) => {
    setChanging(true);
    setFeedback(null);
    try {
      await manager.setCloudSyncEnabled(enabled);
      setFeedback({ message: enabled ? t("已开启 2FA 云同步") : t("已关闭 2FA 云同步"), error: false });
    } catch {
      setFeedback({ message: enabled ? t("同步未完成，请稍后重试") : t("关闭 2FA 云同步失败，请重试"), error: true });
    } finally {
      setChanging(false);
    }
  };
  const disabled = changing || manager.syncing || !manager.initialized;
  return <>
    <Text style={styles.sectionLabel}>{t("2FA 密钥")}</Text>
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text style={styles.title}>{t("自动云同步")}</Text>
          <Text style={styles.description}>{t("开启后自动同步变更；关闭时仍可在 2FA 页面下拉获取云端密钥。")}</Text>
        </View>
        {disabled ? <ActivityIndicator color={color("#18af8c", 'accent')} size="small" /> : <Switch
          accessibilityLabel={t("同步 2FA 密钥至云端")} value={manager.cloudSyncEnabled}
          onValueChange={(enabled) => void change(enabled)}
          trackColor={{ false: '#c8d6cd', true: '#87d9cb' }}
          thumbColor={manager.cloudSyncEnabled ? '#18af8c' : '#fff'} />}
      </View>
      <Text style={styles.warning}>
        {t("默认关闭。开启后，手机上的敏感密钥会上传并保存到你的云端服务器。")}</Text>
      {feedback ? <Text accessibilityRole="alert" style={[styles.feedback, feedback.error && styles.error]}>
        {feedback.message}
      </Text> : null}
    </View>
  </>;
}

const useStyles = createThemedStyles((color) => ({
  sectionLabel: {
    color: color('#6f8177', 'muted'),
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 3,
    marginBottom: 9,
    marginTop: 2,
  },
  card: {
    backgroundColor: color('#fff', 'surface'),
    borderColor: color('#dce8df', 'border'),
    borderWidth: 1,
    borderRadius: 16,
    padding: 17,
    marginBottom: 22,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  copy: { flex: 1, minWidth: 0 },
  title: { color: color('#13231c', 'ink'), fontSize: 16, fontWeight: '800' },
  description: { color: color('#6f8177', 'muted'), fontSize: 12, lineHeight: 18, marginTop: 6 },
  warning: { color: color('#9a6c17', 'warning'), fontSize: 11, lineHeight: 17, marginTop: 13 },
  feedback: { color: color('#14806f', 'accent'), fontSize: 12, lineHeight: 18, marginTop: 12 },
  error: { color: color('#dc5c55', 'danger') },
}));
