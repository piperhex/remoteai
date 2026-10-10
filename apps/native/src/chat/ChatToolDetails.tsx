import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import {  Text } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { SheetScrollView, SHEET_READABLE_WIDTH } from '../components/SheetScrollView';
import type { Item } from './types';
import { useStyles } from './styles';
import { messageLabel } from '../../../../shared/chat/messageDetails';
import { ChatToolContent } from './ChatToolContent';
import { QuoteSourceContext } from './ChatQuotes';

export function ChatToolDetails({ item, onClose, onBack }: {
  item: Item; onClose: () => void; onBack?: () => void;
}) {
  const sheetStyles = useSheetStyles();
  const styles = useStyles();
  useLanguage();
  const messageRole = item.type === 'userMessage' ? 'user' : 'assistant';
  const role = ['userMessage', 'agentMessage'].includes(item.type) ? messageRole : 'tool';
  return <BottomSheet fullWidthContent
    visible tall title={t(messageLabel(item))} onClose={onClose} onBack={onBack} dragFromHeaderOnly>
    <SheetScrollView style={sheetStyles.scroll} contentContainerStyle={sheetStyles.content}
      showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
      {item.status === 'inProgress' && <Text style={styles.subtitle}>{t("进行中…")}</Text>}
      <QuoteSourceContext.Provider value={{ messageId: item.id, onQuote: onClose, role }}>
        <ChatToolContent item={item} />
      </QuoteSourceContext.Provider>
    </SheetScrollView>
  </BottomSheet>;
}

const useSheetStyles = createThemedStyles(() => ({
  scroll: { flexShrink: 1 },
  content: { width: '100%', maxWidth: SHEET_READABLE_WIDTH, alignSelf: 'center', paddingBottom: 20, gap: 16 },
}));
