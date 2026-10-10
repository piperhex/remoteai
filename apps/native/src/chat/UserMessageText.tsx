import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import {  View } from 'react-native';
import { QuoteChip, QuoteDetails } from './ChatQuoteView';
import { useChatQuotes } from './ChatQuotes';
import { ChatMarkdown } from './Markdown';
import { quotedMessage } from './quotedMessage';

export function UserMessageText({ text, copy = false }: { text: string; copy?: boolean }) {
  const messageStyles = useMessageStyles();
  useLanguage();
  const message = useMemo(() => quotedMessage(text), [text]);
  const [selected, setSelected] = useState<number | null>(null);
  const active = useChatQuotes()?.active ?? true;
  useEffect(() => { if (!active) setSelected(null); }, [active]);
  const quote = selected === null ? undefined : message.quotes[selected];
  return <View style={messageStyles.content}>
    {!!message.quotes.length && <View style={messageStyles.quotes}>
      {message.quotes.map((_, index) => <QuoteChip key={index} label={t("查看消息第 {value1} 条引用", { value1: index + 1 })}
        onOpen={() => setSelected(index)} />)}
    </View>}
    {!!message.text && <ChatMarkdown text={message.text} user
      copy={copy ? { text, label: t("复制消息") } : undefined} />}
    {quote !== undefined && active && <QuoteDetails text={quote} onClose={() => setSelected(null)} />}
  </View>;
}

const useMessageStyles = createThemedStyles(() => ({
  content: { gap: 10 },
  quotes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
}));
