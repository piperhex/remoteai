import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { HtmlPreviewDocument } from './html/HtmlPreviewDocument';
import type { HtmlFileContext } from './html/HtmlPreparation';
import { SheetScrollView } from '../components/SheetScrollView';
import { ChatCodeBlock } from './ChatCodeBlock';
import { textMetrics } from '../theme/text';

const PREVIEW_MODES = [{ value: 'preview', get label() { return t("client.chat.preview"); } }, { value: 'source', get label() { return t("client.downloads.source"); } }] as const;

export function isHtmlPath(path: string) {
  return /\.html?$/i.test(path);
}

export function ChatHtmlPreview({ text, context }: { text: string; context?: HtmlFileContext }) {
  const styles = useStyles();
  useLanguage();
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const [failed, setFailed] = useState(false);
  return <View style={styles.container}>
    <View style={styles.tabs} accessibilityRole="tablist">
      {PREVIEW_MODES.map(item => <Pressable key={item.value} accessibilityRole="tab"
        accessibilityState={{ selected: mode === item.value }} onPress={() => setMode(item.value)}
        style={[styles.tab, mode === item.value && styles.selectedTab]}>
        <Text style={styles.tabText}>{item.label}</Text>
      </Pressable>)}
    </View>
    {mode === 'source' && <SheetScrollView style={styles.content}>
      <ChatCodeBlock text={text} label={t("client.mobile.fullText")} language="html" lineNumbers copyLabel={t("client.chat.copyFileContents")} />
    </SheetScrollView>}
    {mode === 'preview' && failed && <View style={styles.notice}>
      <Text accessibilityRole="alert" style={styles.message}>{t("client.mobile.pageUnavailableTryAgainOrViewTheSource")}</Text>
      <Pressable accessibilityRole="button" onPress={() => setFailed(false)} style={styles.tab}>
        <Text style={styles.tabText}>{t("client.mobile.retryPreview")}</Text>
      </Pressable>
    </View>}
    {mode === 'preview' && !failed && <HtmlPreviewDocument text={text} context={context}
      onError={() => setFailed(true)} />}
  </View>;
}

const useStyles = createThemedStyles((color) => ({
  container: { flex: 1, minHeight: 0 },
  content: { flex: 1, backgroundColor: color('#fff', 'surface') },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  tab: { minHeight: 44, paddingHorizontal: 20, justifyContent: 'center', borderRadius: 12 },
  selectedTab: { backgroundColor: color('#e3f3ed', 'canvas') },
  tabText: { ...textMetrics(14, 21), color: color('#0b8065', 'accent'), fontWeight: '700' },
  notice: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  message: { ...textMetrics(14, 21), maxWidth: 400, color: color('#708078', 'muted'), textAlign: 'center' },
}));
