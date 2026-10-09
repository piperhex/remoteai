import { Text } from 'react-native';
import { t, useLanguage } from '../i18n';
import { useConversationMetrics } from '../../../../shared/remote-chat/client/useConversationMetrics';
import { CONVERSATION_TPS_DESCRIPTION, CONVERSATION_TTFT_DESCRIPTION, formatConversationTps, formatConversationTtft,
  type ReadConversationMetrics } from '../../../../shared/remote-chat/conversationMetrics';

export function ConversationPerformance({ read, threadId, active }: {
  read: ReadConversationMetrics; threadId: string | null; active: boolean;
}) {
  useLanguage();
  const metrics = useConversationMetrics(read, threadId, active);
  const speed = `${formatConversationTps(metrics)} TPS`;
  const firstToken = `TTFT ${formatConversationTtft(metrics)}`;
  return <>
    <Text accessibilityLabel={`${t('对话输出速度')} ${speed}`}
      accessibilityHint={t(CONVERSATION_TPS_DESCRIPTION)}>{speed}</Text>
    {' '}
    <Text accessibilityLabel={`${t('首 token 等待时间')} ${firstToken}`}
      accessibilityHint={t(CONVERSATION_TTFT_DESCRIPTION)}>{firstToken}</Text>
  </>;
}
