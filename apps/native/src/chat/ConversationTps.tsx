import { Text } from 'react-native';
import { t, useLanguage } from '../i18n';
import { useConversationMetrics } from '../../../../shared/remote-chat/client/useConversationMetrics';
import { CONVERSATION_TPS_DESCRIPTION, formatConversationTps,
  type ReadConversationMetrics } from '../../../../shared/remote-chat/conversationMetrics';

export function ConversationTps({ read, threadId, active }: {
  read: ReadConversationMetrics; threadId: string | null; active: boolean;
}) {
  useLanguage();
  const metrics = useConversationMetrics(read, threadId, active);
  return <Text accessibilityLabel={`${t('对话输出速度')} ${formatConversationTps(metrics)} TPS`}
    accessibilityHint={t(CONVERSATION_TPS_DESCRIPTION)}>{formatConversationTps(metrics)} TPS</Text>;
}
