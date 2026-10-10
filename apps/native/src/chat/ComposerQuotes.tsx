import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
﻿import { useEffect, useState } from 'react';
import {  View } from 'react-native';
import { quoteKey } from './replyQuotes';
import { useChatQuotes } from './ChatQuotes';
import { QuoteChip, QuoteDetails } from './ChatQuoteView';

export function ComposerQuotes({ disabled, active }: { disabled: boolean; active: boolean }) {
  const quoteStyles = useQuoteStyles();
  useLanguage();
  const draft = useChatQuotes();
  const [selected, setSelected] = useState<string | null>(null);
  const quote = draft?.quotes.find((entry) => quoteKey(entry) === selected);
  useEffect(() => { if (!quote || !active) setSelected(null); }, [quote, active]);
  if (!draft?.quotes.length) return null;
  return <>
    <View style={quoteStyles.chips} accessibilityLabel={t("引用的内容")}>
      {draft.quotes.map((entry, index) => <QuoteChip key={quoteKey(entry)} label={t("查看第 {value1} 条引用", { value1: index + 1 })}
        onOpen={() => setSelected(quoteKey(entry))} remove={{ label: t("移除第 {value1} 条引用", { value1: index + 1 }), disabled,
          onPress: () => draft.remove(quoteKey(entry)) }} />)}
    </View>
    {quote && active && <QuoteDetails text={quote.text} onClose={() => setSelected(null)} />}
  </>;
}

const useQuoteStyles = createThemedStyles(() => ({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 6, paddingTop: 6, paddingBottom: 4 },
}));
