import { useLanguage } from '../i18n';
import type { TokenSummary } from '../../../../shared/remote-chat/tokenSummary';
import { officialUsageLabels } from '../../../../shared/officialUsageLabels';
import { formatTokens } from '../../../../shared/remote-chat/usage';

export function OfficialUsagePanel({ data }: { data: TokenSummary }) {
  const labels = officialUsageLabels(useLanguage());
  const usage = data.officialUsage;
  if (!usage) return null;
  return <section className="chat-token-card"><h3>{labels.title}</h3>
    <p className="chat-muted">{usage.status === 'unavailable' ? labels.unavailableStatus
      : usage.status === 'signedOut' ? labels.signedOut : labels.ready}</p>
    <p className="chat-muted">{labels.hint}</p>
    {usage.accounts.map((account) => <div key={account.accountId}>
      <strong>{account.accountLabel}</strong>
      <p>{labels.remaining}: <strong>{account.remainingUsd == null ? labels.unavailable
        : `$${account.remainingUsd.toFixed(2)}`}</strong></p>
      {(['primary', 'secondary'] as const).filter((key) => account[key]).map((key) => <p className="chat-muted" key={key}>
        {labels[key]} · {labels.capacity}: {account[key]?.capacityUsd == null ? labels.unavailable
          : `$${account[key]?.capacityUsd?.toFixed(2)}`}
      </p>)}
      <details><summary>{formatTokens(account.tokens)} Token · ${account.costUsd.toFixed(2)} · {labels.devices}</summary>
      {account.devices.map((device) => <p className="chat-muted" key={device.deviceId}>
        {device.deviceName} · {formatTokens(device.tokens)} Token · ${device.costUsd.toFixed(2)}
      </p>)}
      </details>
    </div>)}
    {!usage.accounts.length && <p className="chat-muted">{labels.empty}</p>}
  </section>;
}
