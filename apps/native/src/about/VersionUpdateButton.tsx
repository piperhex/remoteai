import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, Text } from 'react-native';
import type { useAppUpdate } from './useAppUpdate';
import { useStyles } from './styles';
import { useStyles as useSettingsStyles } from '../settings/styles';

type UpdateState = ReturnType<typeof useAppUpdate>;

function updateAction(update: UpdateState) {
  const { downloadState, updateCheck, checking } = update;
  if (downloadState.status === 'downloaded') return { label: t("立即安装"), onPress: update.installDownloaded };
  if (downloadState.status === 'downloading') return { label: t("下载中"), busy: true };
  if (checking) return { label: t("检查中"), busy: true };
  if (updateCheck?.updateAvailable) {
    return { label: downloadState.status === 'failed' ? t("重新下载") : t("更新"),
      onPress: () => update.beginDownload(updateCheck.release) };
  }
  if (update.error) return { label: t("重试"), onPress: () => void update.checkForUpdate() };
  return { label: updateCheck ? t("已是最新") : t("检查更新"), current: Boolean(updateCheck),
    onPress: () => void update.checkForUpdate() };
}

export function VersionUpdateButton({ update }: { update: UpdateState }) {
  const resolveThemeColor = useThemeColor();
  const styles = useStyles();
  const settingsStyles = useSettingsStyles();
  const color = useThemeColor();
  useLanguage();
  const action = updateAction(update);
  return <Pressable accessibilityRole="button" accessibilityLabel={action.label}
    accessibilityState={{ disabled: Boolean(action.busy), busy: Boolean(action.busy) }} disabled={Boolean(action.busy)}
    onPress={action.onPress} style={({ pressed }) => [styles.versionButton,
      action.current && styles.currentButton, pressed && settingsStyles.pressed]}>
    {action.busy ? <ActivityIndicator size="small" color={color("#079c70", 'accent')} />
      : <Ionicons name={action.current ? 'checkmark-circle-outline' : 'arrow-up-circle-outline'}
        size={16} color={action.current ? resolveThemeColor('#7d8496', 'muted') : resolveThemeColor('#079c70', 'accent')} />}
    <Text style={[styles.versionButtonText, action.current && styles.currentText]}>{action.label}</Text>
  </Pressable>;
}
