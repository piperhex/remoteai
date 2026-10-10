import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { useContext } from 'react';
import { Pressable, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BottomSheet } from '../components/BottomSheet';
import { SheetScrollView, SHEET_READABLE_WIDTH } from '../components/SheetScrollView';
import { QuoteSourceContext } from './ChatQuotes';
import { SelectableChatText } from './SelectableChatText';
import { palette, useStyles } from './styles';

export function QuoteChip({ label, onOpen, remove }: {
  label: string; onOpen: () => void; remove?: { label: string; disabled: boolean; onPress: () => void };
}) {
  const quoteStyles = useQuoteStyles();
  const color = useThemeColor();
  useLanguage();
  return <View style={quoteStyles.chip}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onOpen}
      style={[quoteStyles.preview, !remove && quoteStyles.readonly]}>
      <MaterialCommunityIcons name="comment-quote-outline" size={17} color={color(palette.ink, 'ink')} />
      <Text style={quoteStyles.label}>{t("1 条引用")}</Text>
    </Pressable>
    {remove && <Pressable accessibilityRole="button" accessibilityLabel={remove.label}
      disabled={remove.disabled} onPress={remove.onPress} style={quoteStyles.remove}>
      <Feather name="x" size={16} color={color(palette.muted, 'muted')} />
    </Pressable>}
  </View>;
}

export function QuoteDetails({ text, onClose }: { text: string; onClose: () => void }) {
  const quoteStyles = useQuoteStyles();
  const styles = useStyles();
  useLanguage();
  const source = useContext(QuoteSourceContext);
  return <BottomSheet fullWidthContent visible title={t("引用详情")} onClose={onClose} dragFromHeaderOnly>
    <SheetScrollView contentContainerStyle={quoteStyles.details}>
      <QuoteSourceContext.Provider value={source ? { ...source, onQuote: () => {
        onClose(); source.onQuote?.();
      } } : null}>
        <SelectableChatText style={[styles.messageText, quoteStyles.blockquote]}
          copy={{ text, label: t("复制引用") }}>{text}</SelectableChatText>
      </QuoteSourceContext.Provider>
    </SheetScrollView>
  </BottomSheet>;
}

const useQuoteStyles = createThemedStyles((color) => ({
  chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: color('#dce4e0', 'border'),
    borderRadius: 14, backgroundColor: color('#fafcfb', 'surface') },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 12, minHeight: 40 },
  readonly: { paddingRight: 12 },
  label: { color: color(palette.ink, 'ink'), fontSize: 13, lineHeight: 20 },
  remove: { minWidth: 36, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  details: { maxWidth: SHEET_READABLE_WIDTH, width: '100%', alignSelf: 'center', paddingBottom: 20 },
  blockquote: { borderLeftWidth: 3, borderLeftColor: color('#dce4e0', 'border'), paddingLeft: 12 },
}));
