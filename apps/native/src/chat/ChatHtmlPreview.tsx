import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { useMemo, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import { SheetScrollView } from '../components/SheetScrollView';
import { ChatCodeBlock } from './ChatCodeBlock';

const PREVIEW_HEIGHT_RATIO = 0.55;
const PREVIEW_MODES = [{ value: 'preview', get label() { return t("预览"); } }, { value: 'source', get label() { return t("源码"); } }] as const;

export function isHtmlPath(path: string) {
  return /\.html?$/i.test(path);
}

export function ChatHtmlPreview({ text }: { text: string }) {
  const styles = useStyles();
  useLanguage();
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const [failed, setFailed] = useState(false);
  const { height } = useWindowDimensions();
  const source = useMemo(() => ({ html: text, baseUrl: 'about:blank' }), [text]);
  return <View style={[styles.container, { height: height * PREVIEW_HEIGHT_RATIO }]}>
    <View style={styles.tabs} accessibilityRole="tablist">
      {PREVIEW_MODES.map(item => <Pressable key={item.value} accessibilityRole="tab"
        accessibilityState={{ selected: mode === item.value }} onPress={() => setMode(item.value)}
        style={[styles.tab, mode === item.value && styles.selectedTab]}>
        <Text style={styles.tabText}>{item.label}</Text>
      </Pressable>)}
    </View>
    {mode === 'source' && <SheetScrollView style={styles.content}>
      <ChatCodeBlock text={text} label={t("完整文本")} language="html" lineNumbers copyLabel={t("复制文件内容")} />
    </SheetScrollView>}
    {mode === 'preview' && failed && <View style={styles.notice}>
      <Text accessibilityRole="alert" style={styles.message}>{t("页面暂时无法显示，请重试或查看源码。")}</Text>
      <Pressable accessibilityRole="button" onPress={() => setFailed(false)} style={styles.tab}>
        <Text style={styles.tabText}>{t("重新预览")}</Text>
      </Pressable>
    </View>}
    {mode === 'preview' && !failed && <WebView source={source} style={styles.content} incognito
      // Handle every navigation here so unsupported links never launch another app.
      originWhitelist={['*']}
      onShouldStartLoadWithRequest={({ url }) => url === 'about:blank' || url.startsWith('about:blank#')}
      javaScriptEnabled domStorageEnabled={false} sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false}
      allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
      setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false}
      geolocationEnabled={false} mediaCapturePermissionGrantType="deny" mediaPlaybackRequiresUserAction
      onError={() => setFailed(true)} />}
  </View>;
}

const useStyles = createThemedStyles((color) => ({
  container: { flexShrink: 1 },
  content: { flex: 1, backgroundColor: color('#fff', 'surface') },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  tab: { minHeight: 44, paddingHorizontal: 20, justifyContent: 'center', borderRadius: 12 },
  selectedTab: { backgroundColor: color('#e3f3ed', 'canvas') },
  tabText: { color: color('#0b8065', 'accent'), fontSize: 14, fontWeight: '700' },
  notice: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  message: { maxWidth: 400, color: color('#708078', 'muted'), fontSize: 14, textAlign: 'center' },
}));
