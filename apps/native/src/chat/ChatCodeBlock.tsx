import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { CopyAction } from './CopyTextButton';
import { palette, useStyles } from './styles';
import { HighlightedCode } from './ChatCodeHighlight';
import { SelectableChatText } from './SelectableChatText';
import { useCodePagination } from './useCodePagination';

interface Props {
  text: string; label?: string; language?: string; lineNumbers?: boolean; copyLabel?: string; replyCopy?: CopyAction;
}

/** Limit native text layout work while keeping the entire output available to read and copy. */
export function ChatCodeBlock({ text, label = t("代码"), language = '', lineNumbers = false,
  copyLabel = t("复制代码"), replyCopy }: Props) {
  const styles = useStyles();
  const codeStyles = useCodeStyles();
  useLanguage();
  const { limit, ...pagination } = useCodePagination(text.length);
  const [wrap, setWrap] = useState(false);
  const visible = text.slice(0, limit);
  const displayed = lineNumbers
    ? visible.split('\n').map((line, index) => `${index + 1}  ${line}`).join('\n') : visible;
  const actions = [{ text, label: copyLabel }, ...replyCopy ? [replyCopy] : []];
  const content = <SelectableChatText style={[styles.code, codeStyles.content]} copy={actions}>
    <HighlightedCode text={displayed.trimEnd() || t("（空文件）")} language={language} />
  </SelectableChatText>;
  return <View style={codeStyles.block}>
    <View style={codeStyles.toolbar}>
      <Text style={[codeStyles.label, styles.fill]}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t("自动换行")} accessibilityState={{ selected: wrap }}
        onPress={() => setWrap(!wrap)} style={codeStyles.action}>
        <Text style={[codeStyles.label, wrap && codeStyles.selected]}>{t("自动换行")}</Text></Pressable>
    </View>
    <ScrollView nestedScrollEnabled style={codeStyles.viewport} {...pagination}>
      {wrap ? content : <ScrollView horizontal nestedScrollEnabled>{content}</ScrollView>}
    </ScrollView>
  </View>;
}

const useCodeStyles = createThemedStyles((color) => ({
  block: { backgroundColor: color('#f4f6f5', 'canvas'), borderRadius: 10, borderWidth: 1,
    borderColor: color(palette.border, 'border'), overflow: 'hidden', marginVertical: 12 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: color(palette.border, 'border') },
  label: { color: color(palette.muted, 'muted'), fontSize: 12, lineHeight: 19 },
  action: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 4 },
  selected: { color: color(palette.green, 'accent') },
  viewport: { maxHeight: 600 },
  content: { padding: 16 },
}));
