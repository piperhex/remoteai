import { createThemedStyles } from '../../theme/styles';
import { t, useLanguage } from '../../i18n';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { VideoClient } from '../../../../../shared/remote-chat/video';
import { useImageOrientation } from '../useImageOrientation';
import { useVideoStream } from './useVideoStream';
import { videoPlayerHtml } from './videoPlayerHtml';
import type { FileClient } from '../../../../../shared/remote-chat/fileDownload';
import { useManagedDownload } from '../../downloads/useManagedDownload';

interface Props {
  path: string; threadId: string | null; ready: boolean; client: VideoClient; close: () => void;
  files: FileClient;
}
export function VideoViewer({ close, ...options }: Props) {
  const styles = useStyles();
  useLanguage();
  const video = useVideoStream(options);
  const download = useManagedDownload({ ...options, client: options.files });
  const orientation = useImageOrientation();
  const [failedUrl, setFailedUrl] = useState('');
  const error = video.error || (video.url && video.url === failedUrl
    ? t("暂时无法播放此视频，请换一个 MP4 视频试试。") : '');
  const source = useMemo(() => video.url
    ? { html: videoPlayerHtml(video.url), baseUrl: video.url } : undefined, [video.url]);
  return <Modal visible animationType="fade" onRequestClose={close} statusBarTranslucent
    navigationBarTranslucent supportedOrientations={['portrait', 'portrait-upside-down',
      'landscape-left', 'landscape-right']}>
    <SafeAreaProvider>
      <SafeAreaView style={styles.overlay}>
        <View style={styles.toolbar}>
          <Text numberOfLines={1} style={styles.title}>{options.path.split(/[\\/]/).pop()}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={download.label}
            disabled={!download.busy && !download.completed && !options.ready}
            onPress={download.busy ? download.cancel : download.start} style={styles.download}>
            <Text style={styles.status}>{download.label}</Text>
          </Pressable>
          {orientation.suggested && <Pressable accessibilityRole="button" accessibilityLabel={t("旋转视频")}
            disabled={orientation.rotating} onPress={orientation.rotate} style={styles.button}>
            <MaterialCommunityIcons name="screen-rotation" size={26} color="#fff" />
          </Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel={t("关闭视频")} onPress={close} style={styles.button}>
            <MaterialCommunityIcons name="close" size={28} color="#fff" />
          </Pressable>
        </View>
        {!!source && !error && <WebView key={video.url} source={source} style={styles.player}
          originWhitelist={['http://127.0.0.1:*', 'about:blank']} allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction allowsFullscreenVideo={false}
          allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
          setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false}
          onShouldStartLoadWithRequest={({ url }) => url === video.url || url === 'about:blank'}
          onMessage={({ nativeEvent }) => { if (nativeEvent.data === 'error') setFailedUrl(video.url); }}
          onError={() => setFailedUrl(video.url)} />}
        {(!source || !!error) && <View style={styles.notice}>
          {!!error ? <>
            <Text accessibilityRole="alert" style={styles.status}>{error}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t("重新加载视频")} onPress={video.retry}
              disabled={!options.ready} style={styles.retry}><Text style={styles.status}>{t("重试")}</Text></Pressable>
          </> : options.ready ? <ActivityIndicator color="#fff" accessibilityLabel={t("正在加载视频")} />
            : <Text style={styles.status}>{t("请连接电脑后播放视频。")}</Text>}
        </View>}
        {!!orientation.error && <Text style={styles.status}>{orientation.error}</Text>}
        {download.busy && !!download.detail && <Text style={styles.status}>{download.detail}</Text>}
        {!!download.message && <Text accessibilityLiveRegion="polite" style={styles.status}>{download.message}</Text>}
      </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}
const useStyles = createThemedStyles((color) => ({
  overlay: { flex: 1, backgroundColor: '#000' },
  toolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  title: { flex: 1, color: color('#ddd', 'faint'), fontSize: 14 },
  button: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  download: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 },
  player: { flex: 1, backgroundColor: '#000' },
  notice: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  status: { color: color('#ddd', 'faint'), fontSize: 14, textAlign: 'center', maxWidth: 400 },
  retry: { minHeight: 44, minWidth: 88, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#333', borderRadius: 12 },
}));
