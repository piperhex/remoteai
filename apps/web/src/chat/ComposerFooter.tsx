import type { UsageSummary } from '../../../../shared/remote-chat/usage';
import type { ConversationMetrics } from '../../../../shared/remote-chat/conversationMetrics';
import { UsageFooter } from '../../../../shared/chat/UsageFooter';
import { t, useLanguage } from '../i18n';
import type { ComposerProps } from './composerProps';
import { ConversationPerformanceValues } from './ConversationPerformance';
import './composerFooter.css';
import { CodexVersionStatus } from '../../../../shared/codex-status/CodexVersionStatus';
import type { ReadCodexServiceStatus } from '../../../../shared/codex-status/status';

type Props = Pick<ComposerProps, 'connectionInfo'>
  & { desktop: boolean; cliVersion?: string | null; usage?: UsageSummary | null; metrics?: ConversationMetrics | null;
    readServiceStatus?: ReadCodexServiceStatus; statusActive?: boolean; statusConnected?: boolean };

export function ComposerFooter({ desktop, cliVersion, connectionInfo,
  usage = null, metrics = null, readServiceStatus, statusActive = true, statusConnected = false }: Props) {
  useLanguage();
  if (!desktop && !connectionInfo) return null;
  return <div className="chat-composer-hint cs-usage-footer-container">
    {desktop && <CodexVersionStatus version={cliVersion} read={readServiceStatus}
      active={statusActive} connected={statusConnected} t={t} />}
    <div className="chat-composer-details">
      {connectionInfo}
      {desktop && <span className="chat-conversation-metrics">
        <UsageFooter usage={usage} translate={t}>
          <ConversationPerformanceValues metrics={metrics} />
        </UsageFooter>
      </span>}
    </div>
  </div>;
}
