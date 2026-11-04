import { Tooltip } from 'antd';
import { useMemo } from 'react';
import { CONVERSATION_TSR_DESCRIPTION, formatConversationTsr, summarizeCommands, type CommandMetricTurn }
  from '../../../../../shared/remote-chat/commandMetrics';
import { uiText } from "../../../../../shared/localization/uiText";
import { UsageFooter } from '../../../../../shared/chat/UsageFooter';
import { CONVERSATION_TPS_DESCRIPTION, CONVERSATION_TTFT_DESCRIPTION, formatConversationTps, formatConversationTtft,
  type ConversationMetrics }
  from '../../../../../shared/remote-chat/conversationMetrics';
import type { UsageSummary } from '../../../../../shared/remote-chat/usage';
import styles from './ConversationTokenStatus.module.less';

export function ConversationTokenStatus({ threadId, active, turns, usage = null, metrics = null }: {
  threadId: string | null; active: boolean; turns?: readonly CommandMetricTurn[];
  usage?: UsageSummary | null;
  metrics?: ConversationMetrics | null;
}) {
  const commands = useMemo(() => turns ? summarizeCommands(turns) : null, [turns]);
  const success = `${formatConversationTsr(active ? commands : null)} TSR`;
  const speed = `${formatConversationTps(active ? metrics : null)} TPS`;
  const firstToken = `${formatConversationTtft(active ? metrics : null)} TTFT`;
  return <span className={styles.status}>
    <UsageFooter usage={usage} translate={uiText}>{threadId && <>
      <Tooltip title={uiText(CONVERSATION_TSR_DESCRIPTION)}
        styles={{ root: { maxWidth: 'min(400px, calc(100vw - 16px))' } }}>
        <span aria-label={uiText('client.chat.commandSuccessRateValue', { value: success })}>{success}</span>
      </Tooltip>
      <span aria-hidden="true"> · </span>
      <Tooltip title={uiText(CONVERSATION_TPS_DESCRIPTION)} styles={{ root: { maxWidth: 400 } }}>
        <span aria-label={`${uiText("client.mobile.conversationOutputSpeed")} ${speed}`}>{speed}</span>
      </Tooltip>
      <span aria-hidden="true"> · </span>
      <Tooltip title={uiText(CONVERSATION_TTFT_DESCRIPTION)} styles={{ root: { maxWidth: 400 } }}>
        <span aria-label={`${uiText("client.mobile.timeToFirstToken")} ${firstToken}`}>{firstToken}</span>
      </Tooltip>
    </>}</UsageFooter>
  </span>;
}
