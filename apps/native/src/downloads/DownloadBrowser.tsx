import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DownloadBrowse } from '../../../../shared/remote-chat/downloads';
import type { ProjectFile, ProjectFilesResponse } from '../../../../shared/remote-chat/projectFiles';
import { DownloadPageHeader } from './DownloadPageHeader';
import { downloadManager } from './manager';
import type { DownloadConnection } from './types';
import { colors, useStyles } from './styles';

export function DownloadBrowser({ connection, scope, back }: {
  connection: DownloadConnection; scope: DownloadBrowse['scope']; back: () => void;
}) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const [directories, setDirectories] = useState(['']);
  const directory = directories[directories.length - 1];
  const [result, setResult] = useState<ProjectFilesResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [adding, setAdding] = useState(false);
  const { client, ready, threadId, cwd } = connection;
  const goBack = useCallback(() => {
    if (directories.length > 1) setDirectories(current => current.slice(0, -1));
    else back();
  }, [directories.length, back]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { goBack(); return true; });
    return () => subscription.remove();
  }, [goBack]);
  useEffect(() => {
    let cancelled = false;
    setError(''); setNotice(''); setResult(undefined);
    if (!ready) { setLoading(false); return; }
    setLoading(true);
    void client.browse({ scope, directory, threadId, cwd })
      .then(value => { if (!cancelled) setResult(value); })
      .catch(() => { if (!cancelled) setError(t("无法读取文件夹，请确认电脑已更新并连接后重试。")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, ready, scope, directory, threadId, cwd, revision]);
  const choose = async (file: ProjectFile) => {
    setNotice('');
    if (file.directory) { setDirectories(current => [...current, file.path]); return; }
    if (adding) return;
    setAdding(true);
    try {
      await downloadManager.enqueue({ owner: connection.owner, deviceId: connection.deviceId,
        deviceName: connection.deviceName, scope, threadId, cwd, path: file.path });
      setNotice(t("已加入下载管理。"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("暂时无法下载，请重试。")); }
    finally { setAdding(false); }
  };
  return <View style={styles.page}>
    <DownloadPageHeader title={scope === 'computer' ? t("此电脑") : t("当前项目")} back={goBack} />
    <FlatList data={result?.entries ?? []} keyExtractor={file => file.path}
      style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}
      ListHeaderComponent={<View style={styles.browserHeader}>
        <View style={styles.browserToolbar}>
          <Text style={styles.sectionLabel}>{t("选择要下载的文件")}</Text>
          <Pressable accessibilityRole="button" onPress={back}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
            <Ionicons name="list-outline" size={17} color={color(colors.green, 'accent')} />
            <Text style={styles.buttonText}>{t("下载列表")}</Text></Pressable>
        </View>
        <Text style={styles.path} numberOfLines={2} ellipsizeMode="middle">
          {result?.directory || directory || connection.deviceName}</Text>
        {!ready && <Text style={styles.error}>{t("请连接这台电脑后浏览文件。")}</Text>}
        {!!notice && <Text accessibilityLiveRegion="polite" style={styles.message}>{notice}</Text>}
        {!!error && <Pressable accessibilityRole="button" accessibilityLabel={t("重试读取文件夹")}
          onPress={() => setRevision(value => value + 1)}><Text style={styles.error}>{error}</Text></Pressable>}
        {loading && <ActivityIndicator accessibilityLabel={t("正在读取文件夹")} color={color(colors.green, 'accent')} />}
      </View>}
      renderItem={({ item }) => <Pressable accessibilityRole="button" disabled={adding || !ready}
        accessibilityLabel={`${item.directory ? t("打开文件夹") : t("下载")}：${item.name}`}
        onPress={() => { void choose(item); }}
        style={({ pressed }) => [styles.row, (adding || !ready) && styles.disabled, pressed && styles.pressed]}>
        <View style={styles.sourceIcon}>
          <Ionicons name={item.directory ? 'folder-outline' : 'document-outline'} size={23} color={color(colors.green, 'accent')} />
        </View>
        <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
        <Ionicons name={item.directory ? 'chevron-forward' : 'download-outline'} size={20} color={color(colors.muted, 'muted')} />
      </Pressable>}
      ListEmptyComponent={!loading && !error && ready ? <Text style={styles.text}>{t("此文件夹没有文件。")}</Text> : null}
      ListFooterComponent={result?.truncated ? <Text style={styles.text}>{t("文件较多，仅显示前 500 项。")}</Text> : null} />
  </View>;
}
