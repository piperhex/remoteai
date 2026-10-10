import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SheetInset, SheetScrollView } from '../components/SheetScrollView';
import { ChatCodeBlock } from './ChatCodeBlock';
import { CopyTextButton } from './CopyTextButton';
import { ChatMarkdown } from './Markdown';
import { palette, useStyles } from './styles';

const PREVIEW_MODES = [{ value: 'preview', get label() { return t("预览"); } }, { value: 'source', get label() { return t("原文"); } }] as const;

export function ChatMarkdownPreview({ text, line }: { text: string; line?: number }) {
  const previewStyles = usePreviewStyles();
  const styles = useStyles();
  useLanguage();
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  return <View style={previewStyles.container}>
    <SheetInset style={previewStyles.toolbar}>
      <View style={previewStyles.tabs} accessibilityRole="tablist">
        {PREVIEW_MODES.map(item => <Pressable key={item.value} accessibilityRole="tab"
          accessibilityState={{ selected: mode === item.value }} onPress={() => setMode(item.value)}
          style={[previewStyles.tab, mode === item.value && previewStyles.selectedTab]}>
          <Text style={previewStyles.tabText}>{item.label}</Text>
        </Pressable>)}
      </View>
      <CopyTextButton text={text} label={t("复制原文")} variant="labeled" />
    </SheetInset>
    <SheetScrollView key={mode} contentContainerStyle={previewStyles.content}>
      {!!line && <Text style={styles.subtitle}>{t("引用位置：第")}{' '}{line}{' '}{t("行")}</Text>}
      {mode === 'source' && <ChatCodeBlock text={text} label={t("原文")} language="markdown"
        lineNumbers copyLabel={t("复制原文")} />}
      {mode === 'preview' && (text.trim()
        ? <ChatMarkdown text={text} /> : <Text style={styles.subtitle}>{t("（空文件）")}</Text>)}
    </SheetScrollView>
  </View>;
}

const usePreviewStyles = createThemedStyles((color) => ({
  container: { flexShrink: 1 },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  tabs: { flexDirection: 'row', gap: 4 },
  tab: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 12 },
  selectedTab: { backgroundColor: color('#e3f3ed', 'canvas') },
  tabText: { color: color(palette.green, 'accent'), fontSize: 14, fontWeight: '700' },
  content: { paddingTop: 12, paddingBottom: 20 },
}));
