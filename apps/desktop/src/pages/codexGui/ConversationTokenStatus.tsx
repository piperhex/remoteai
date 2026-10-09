import { Tooltip } from 'antd';
import { loadConversationMetrics } from '../../api/conversationMetrics';
import { guiText } from '../../i18n/guiText';
import { useConversationMetrics } from '../../../../../shared/remote-chat/client/useConversationMetrics';
import { CONVERSATION_TPS_DESCRIPTION, formatConversationTps }
  from '../../../../../shared/remote-chat/conversationMetrics';
import styles from './ConversationTokenStatus.module.less';

const TOKENS_PER_THOUSAND = 1_000;
const TOKENS_PER_MILLION = 1_000_000;
const TOKEN_DECIMAL_PLACES = 2;

function formatConversationTokens(value: number) {
  if (value >= TOKENS_PER_MILLION) return `${(value / TOKENS_PER_MILLION).toFixed(TOKEN_DECIMAL_PLACES)}M`;
  if (value >= TOKENS_PER_THOUSAND) return `${(value / TOKENS_PER_THOUSAND).toFixed(TOKEN_DECIMAL_PLACES)}k`;
  return value.toLocaleString();
}

export function ConversationTokenStatus({ threadId, tokens, active }: {
  threadId: string | null; tokens: number; active: boolean;
}) {
  const metrics = useConversationMetrics(loadConversationMetrics, threadId, active);
  const speed = `${formatConversationTps(metrics)} TPS`;
  if (!threadId) return null;
  return <span className={styles.status}>
    <Tooltip title={guiText(CONVERSATION_TPS_DESCRIPTION)} styles={{ root: { maxWidth: 400 } }}>
      <span aria-label={`${guiText('对话输出速度')} ${speed}`}>{speed}</span>
    </Tooltip>
    {tokens > 0 && <span>{formatConversationTokens(tokens)} tokens</span>}
  </span>;
}
