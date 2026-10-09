import { Check, Clock3, CircleAlert, Info, MessageSquare, Monitor, RefreshCw, Share2, User } from 'lucide-react';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import { t, useLanguage } from '../i18n';
import { connectionHealth, healthStatusLabels, HEALTH_INLINE_STATUS_MAX_CHARACTERS,
  type HealthStep } from '../../../../shared/remote-chat/connectionHealth';
import type { ChatState } from './types';
import { ChatConnectionAddresses } from './ChatConnectionAddresses';
import './connection-health.css';

const stepIcons = { login: User, computer: Monitor, path: Share2, chat: MessageSquare };
const statusIcons = { ok: Check, waiting: Clock3, blocked: CircleAlert };

export function ChatConnectionHealth({ state, device, reconnect, close }: {
  state: ChatState; device?: { online: boolean }; reconnect: () => void; close: () => void;
}) {
  useLanguage();
  const health = connectionHealth(state, device);
  const StatusIcon = statusIcons[health.status];
  return <AdaptiveSheet open title={t('连接体检')} subtitle={t('检测当前设备与电脑的连接状态')}
    onClose={close} width={448} className="connection-health-sheet">
    <div className="connection-health">
      <div className={`connection-health-summary health-${health.status}`} aria-live="polite">
        <span className="connection-health-summary-icon"><StatusIcon size={22} aria-hidden="true" /></span>
        <div className="connection-health-copy">
          <strong>{t(health.title)}</strong>
          <p>{t(health.description)}</p>
        </div>
      </div>
      <ul className="connection-health-steps">
        {health.steps.map(step => <HealthRow key={step.id} step={step} />)}
      </ul>
      <ChatConnectionAddresses state={state} />
      <div className="connection-health-note">
        <Info size={22} aria-hidden="true" />
        <div className="connection-health-copy">
          <strong>{t(health.nextTitle)}</strong>
          <p>{t(health.next)}</p>
        </div>
      </div>
      {health.reconnect && <button type="button" className="connection-health-reconnect" onClick={reconnect}>
        <RefreshCw size={16} aria-hidden="true" />{t('重新连接')}
      </button>}
    </div>
  </AdaptiveSheet>;
}

function HealthRow({ step }: { step: HealthStep }) {
  const Icon = stepIcons[step.id];
  const StatusIcon = statusIcons[step.status];
  const statusLabel = t(healthStatusLabels[step.status]);
  const inlineStatus = statusLabel.length <= HEALTH_INLINE_STATUS_MAX_CHARACTERS;
  const badge = <span className={`connection-health-badge health-${step.status}`}>
    <span className="connection-health-badge-icon"><StatusIcon size={10} aria-hidden="true" /></span>
    {statusLabel}
  </span>;
  return <li className="connection-health-step" aria-label={`${t(step.label)} · ${statusLabel}`}>
    <span className={`connection-health-step-icon health-step-${step.id}`}><Icon size={22} aria-hidden="true" /></span>
    <div className="connection-health-copy">
      <strong>{t(step.label)}</strong>
      <p>{t(step.detail)}</p>
      {!inlineStatus && badge}
    </div>
    {inlineStatus && badge}
  </li>;
}
