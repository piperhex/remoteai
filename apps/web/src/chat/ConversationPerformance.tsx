import { Tooltip } from 'antd';
import { useEffect, useState } from 'react';
import { t, useLanguage } from '../i18n';
import { useConversationMetrics } from '../../../../shared/remote-chat/client/useConversationMetrics';
import { CONVERSATION_TPS_DESCRIPTION, CONVERSATION_TTFT_DESCRIPTION, formatConversationTps, formatConversationTtft,
  type ReadConversationMetrics } from '../../../../shared/remote-chat/conversationMetrics';

export function ConversationPerformance({ read, threadId, active }: {
  read: ReadConversationMetrics; threadId: string | null; active: boolean;
}) {
  useLanguage();
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const metrics = useConversationMetrics(read, threadId, active && visible);
  const speed = `${formatConversationTps(metrics)} TPS`;
  const firstToken = `TTFT ${formatConversationTtft(metrics)}`;
  return <>
    <Tooltip title={t(CONVERSATION_TPS_DESCRIPTION)} styles={{ root: { maxWidth: 400 } }}>
      <span className="chat-conversation-tps" aria-label={`${t('对话输出速度')} ${speed}`}>{speed}</span>
    </Tooltip>
    {' '}
    <Tooltip title={t(CONVERSATION_TTFT_DESCRIPTION)} styles={{ root: { maxWidth: 400 } }}>
      <span className="chat-conversation-ttft" aria-label={`${t('首 token 等待时间')} ${firstToken}`}>{firstToken}</span>
    </Tooltip>
  </>;
}
