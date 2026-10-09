import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLanguage } from '../i18n';
import type { TokenSummary } from '../../../../shared/remote-chat/tokenSummary';
import { officialUsageLabels } from '../../../../shared/officialUsageLabels';
import { formatTokens } from '../../../../shared/remote-chat/usage';
import { summaryStyles as s } from './styles';

export function OfficialUsagePanel({ data }: { data: TokenSummary }) {
  const labels = officialUsageLabels(useLanguage());
  const [expanded, setExpanded] = useState<string | null>(null);
  const usage = data.officialUsage;
  if (!usage) return null;
  return <View style={s.card}><Text style={s.sectionTitle}>{labels.title}</Text>
    <Text style={s.hint}>{usage.status === 'unavailable' ? labels.unavailableStatus
      : usage.status === 'signedOut' ? labels.signedOut : labels.ready}</Text>
    <Text style={s.hint}>{labels.hint}</Text>
    {usage.accounts.map((account) => <View key={account.accountId} style={{ gap: 6 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === account.accountId }}
        onPress={() => setExpanded(expanded === account.accountId ? null : account.accountId)}>
        <Text style={s.value}>{account.accountLabel}</Text>
        <Text style={s.hint}>{formatTokens(account.tokens)} Token · ${account.costUsd.toFixed(2)}</Text>
      </Pressable>
      <Text style={s.value}>{labels.remaining}: {account.remainingUsd == null ? labels.unavailable
        : `$${account.remainingUsd.toFixed(2)}`}</Text>
      {(['primary', 'secondary'] as const).filter((key) => account[key]).map((key) => <Text style={s.hint} key={key}>
        {labels[key]} · {labels.capacity}: {account[key]?.capacityUsd == null ? labels.unavailable
          : `$${account[key]?.capacityUsd?.toFixed(2)}`}
      </Text>)}
      {expanded === account.accountId && account.devices.map((device) => <Text style={s.hint} key={device.deviceId}>
        {device.deviceName} · {formatTokens(device.tokens)} Token · ${device.costUsd.toFixed(2)}
      </Text>)}
    </View>)}
    {!usage.accounts.length && <Text style={s.hint}>{labels.empty}</Text>}
  </View>;
}
