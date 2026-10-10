import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import {  View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { SheetFlatList } from '../components/SheetScrollView';
import { ChatMessage } from './ChatMessage';
import type { WorkEntry } from './turnPresentation';

export function ChatWorkDrawer({ entry, onOpen, onClose }: {
  entry: Pick<WorkEntry, 'turn' | 'items'>; onOpen: (id: string) => void; onClose: () => void;
}) {
  const workStyles = useWorkStyles();
  useLanguage();
  const running = entry.turn.status === 'inProgress';
  return <BottomSheet fullWidthContent visible tall title={running ? t("正在处理") : t("处理过程")}
    subtitle={t("{value1} 项活动", { value1: entry.items.length })} onClose={onClose} dragFromHeaderOnly>
    <SheetFlatList data={entry.items} keyExtractor={(item) => item.id} style={workStyles.list}
      contentContainerStyle={workStyles.content} keyboardShouldPersistTaps="handled"
      ItemSeparatorComponent={() => <View style={workStyles.separator} />}
      renderItem={({ item }) => <ChatMessage item={item} onOpen={onOpen} process onQuote={onClose}
        running={running && item.status !== 'completed'} />} />
  </BottomSheet>;
}

const useWorkStyles = createThemedStyles(() => ({
  list: { flexShrink: 1 },
  content: { paddingBottom: 20 },
  separator: { height: 14 },
}));
