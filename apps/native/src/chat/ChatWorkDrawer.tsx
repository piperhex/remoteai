import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { useState } from 'react';
import { View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { SheetFlatList } from '../components/SheetScrollView';
import { ChatActivityRow, ChatMessage } from './ChatMessage';
import { ChatToolContent } from './ChatToolContent';
import { QuoteSourceContext } from './ChatQuotes';
import type { WorkEntry } from './turnPresentation';
import { useStyles } from './styles';

export function ChatWorkDrawer({ entry, onClose }: {
  entry: Pick<WorkEntry, 'turn' | 'items'>; onClose: () => void;
}) {
  const workStyles = useWorkStyles();
  const styles = useStyles();
  // Keep expansion outside virtualized cells so scrolling and live updates retain the user's choice.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setExpanded(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  useLanguage();
  const running = entry.turn.status === 'inProgress';
  return <BottomSheet fullWidthContent visible fullscreen
    title={running ? t("client.chat.working") : t("client.chat.activity")}
    subtitle={t("client.chat.actions", { value1: entry.items.length })} onClose={onClose}>
    <SheetFlatList data={entry.items} extraData={expanded} keyExtractor={(item) => item.id} style={workStyles.list}
      contentContainerStyle={workStyles.content} keyboardShouldPersistTaps="handled"
      ItemSeparatorComponent={() => <View style={styles.processSeparator} />}
      renderItem={({ item }) => ['userMessage', 'agentMessage'].includes(item.type)
        ? <ChatMessage item={item} onOpen={toggle} process onQuote={onClose}
          running={running && item.status !== 'completed'} />
        : <View>
          <ChatActivityRow item={item} onOpen={toggle} running={running} expanded={expanded.has(item.id)} />
          {expanded.has(item.id) && <View style={workStyles.details}>
            <QuoteSourceContext.Provider value={{ messageId: item.id, role: 'tool', onQuote: onClose }}>
              <ChatToolContent item={item} />
            </QuoteSourceContext.Provider>
          </View>}
        </View>} />
  </BottomSheet>;
}

const useWorkStyles = createThemedStyles(color => ({
  list: { flex: 1 },
  content: { paddingBottom: 20 },
  details: { marginTop: 8, marginLeft: 7, paddingLeft: 16, paddingBottom: 12,
    borderLeftWidth: 1, borderColor: color('#dfe5e1', 'border') },
}));
