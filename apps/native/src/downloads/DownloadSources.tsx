import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { downloadConnectionLabel } from '../../../../shared/remote-chat/downloadConnection';
import type { DownloadConnection } from './types';
import { colors, useStyles } from './styles';

function SourceCard({ scope, disabled, onPress }: {
  scope: 'project' | 'computer'; disabled: boolean; onPress: () => void;
}) {
  const resolveThemeColor = useThemeColor();
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const project = scope === 'project';
  return <Pressable accessibilityRole="button" accessibilityLabel={project ? t("当前项目") : t("此电脑")}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.sourceCard, disabled && styles.disabled, pressed && styles.pressed]}>
    <View style={[styles.sourceIcon, !project && styles.computerIcon]}>
      <Ionicons name={project ? 'folder-outline' : 'desktop-outline'} size={23}
        color={project ? resolveThemeColor(colors.green, 'accent') : resolveThemeColor(colors.blue, 'info')} />
    </View>
    <View style={styles.sourceCopy}>
      <Text style={styles.sourceTitle}>{project ? t("当前项目") : t("此电脑")}</Text>
      <Text style={styles.caption}>{project ? t("浏览项目文件") : t("浏览电脑文件")}</Text>
    </View>
    <Ionicons name="chevron-forward" size={16} color={color(colors.muted, 'muted')} style={styles.sourceChevron} />
  </Pressable>;
}

export function DownloadSources({ connection, browse }: {
  connection?: DownloadConnection; browse: (scope: 'project' | 'computer') => void;
}) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const ready = !!connection?.ready;
  const canBrowseProject = ready && !!(connection.cwd || connection.threadId);
  let hint = t("离开此页面后，下载仍会继续。");
  if (!ready) hint = t("先在聊天中连接电脑，即可添加下载。");
  else if (!canBrowseProject) hint = t("在聊天中选择项目，或从此电脑添加下载。");
  return <View style={styles.sources}>
    <View style={styles.connection}>
      <View style={[styles.connectionDot, !ready && styles.offlineDot]} />
      <Text style={styles.connectionName} numberOfLines={1}>{connection?.deviceName || t("尚未连接电脑")}</Text>
      <Text style={styles.caption}>{t(downloadConnectionLabel(connection?.mode))}</Text>
    </View>
    <Text style={styles.sectionLabel}>{t("添加下载")}</Text>
    <View style={styles.sourceRow}>
      <SourceCard scope="project" disabled={!canBrowseProject} onPress={() => browse('project')} />
      <SourceCard scope="computer" disabled={!ready} onPress={() => browse('computer')} />
    </View>
    <View style={styles.hint}>
      <Ionicons name="information-circle-outline" size={15} color={color(colors.muted, 'muted')} />
      <Text style={styles.hintText}>{hint}</Text>
    </View>
  </View>;
}
