import { getLocale, t, useLanguage } from '../i18n';
import { Text, View } from 'react-native';
import type { useAppUpdate } from './useAppUpdate';
import { useStyles } from './styles';
import { ReleaseNotes } from './ReleaseNotes';

type UpdateState = ReturnType<typeof useAppUpdate>;

function DownloadStatus({ update }: { update: UpdateState }) {
  const styles = useStyles();
  useLanguage();
  const state = update.downloadState;
  if (state.status === 'idle') return null;
  if (state.status === 'downloading') return <View style={styles.status}>
    <Text style={styles.statusTitle}>{t("正在下载 v")}{state.version}</Text>
    <Text style={styles.detail}>{t("可以离开此页面，在通知栏查看下载进度。")}</Text>
  </View>;
  if (state.status === 'failed') return <View style={styles.status}>
    <Text style={[styles.statusTitle, styles.error]}>v{state.version}{' '}{t("下载失败")}</Text>
    <Text style={styles.detail}>{t("下载未完成，请检查网络后点击“重新下载”。")}</Text>
  </View>;
  return <View style={styles.status}>
    <Text style={styles.statusTitle}>v{state.version}{' '}{t("已下载")}</Text>
    <Text style={styles.detail}>{t("更新已准备好，可以开始安装。")}</Text>
  </View>;
}

function ReleaseDetails({ update }: { update: UpdateState }) {
  const styles = useStyles();
  useLanguage();
  const result = update.updateCheck;
  if (!result) return null;
  const { release, updateAvailable } = result;
  return <View style={styles.status}>
    <View style={styles.statusHeading}>
      <Text style={styles.statusTitle}>{t("最新版本 v")}{release.version}</Text>
      <Text style={styles.statusLabel}>{updateAvailable ? t("可更新") : t("已是最新")}</Text>
    </View>
    {release.publishedAt ? <Text style={styles.detail}>
      {t("发布于")}{' '}{new Date(release.publishedAt).toLocaleDateString(getLocale())}
    </Text> : null}
    {updateAvailable ? <ReleaseNotes text={release.notes} /> : null}
  </View>;
}

export function UpdateDetails({ update }: { update: UpdateState }) {
  const styles = useStyles();
  useLanguage();
  if (update.error) return <View style={styles.updateDetails}>
    <Text accessibilityRole="alert" style={[styles.detail, styles.error]}>{update.error}</Text>
  </View>;
  if (!update.updateCheck && update.downloadState.status === 'idle') return null;
  if (!update.updateCheck?.updateAvailable && update.downloadState.status === 'idle') return null;
  return <View style={styles.updateDetails}>
    <DownloadStatus update={update} />
    <ReleaseDetails update={update} />
  </View>;
}
