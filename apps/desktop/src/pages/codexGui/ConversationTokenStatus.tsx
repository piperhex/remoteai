import { Tooltip } from 'antd';
import { loadConversationMetrics } from '../../api/conversationMetrics';
import { guiText } from '../../i18n/guiText';
import { useConversationMetrics } from '../../../../../shared/remote-chat/client/useConversationMetrics';
import { CONVERSATION_TPS_DESCRIPTION, CONVERSATION_TTFT_DESCRIPTION, formatConversationTps, formatConversationTtft }
  from '../../../../../shared/remote-chat/conversationMetrics';
import { formatConversationTokens } from '../../../../../shared/remote-chat/usage';
import styles from './ConversationTokenStatus.module.less';

export function ConversationTokenStatus({ threadId, tokens, active }: {
  threadId: string | null; tokens: number; active: boolean;
}) {
  const metrics = useConversationMetrics(loadConversationMetrics, threadId, active);
  const speed = `${formatConversationTps(metrics)} TPS`;
  const firstToken = `${formatConversationTtft(metrics)} TTFT`;
  if (!threadId) return null;
  return <span className={styles.status}>
    <Tooltip title={guiText(CONVERSATION_TPS_DESCRIPTION)} styles={{ root: { maxWidth: 400 } }}>
      <span aria-label={`${guiText('对话输出速度')} ${speed}`}>{speed}</span>
    </Tooltip>
    <span aria-hidden="true"> · </span>
    <Tooltip title={guiText(CONVERSATION_TTFT_DESCRIPTION)} styles={{ root: { maxWidth: 400 } }}>
      <span aria-label={`${guiText('首 token 等待时间')} ${firstToken}`}>{firstToken}</span>
    </Tooltip>
    {tokens > 0 && <>
      <span aria-hidden="true"> · </span>
      <span>{formatConversationTokens(tokens)} tokens</span>
    </>}
  </span>;
}
