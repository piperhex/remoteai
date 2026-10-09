import { Table, Tooltip } from 'antd';
import type { Language } from '../../i18n';
import type { OfficialAccountTotal } from '../../../../../shared/officialUsage';
import { officialUsageLabels } from '../../../../../shared/officialUsageLabels';
import { useOfficialUsage } from '../../hooks/useOfficialUsage';
import { formatTokens } from './chartUtils';
import { formatEstimatedCost, type TokenCostDisplaySettings } from '../../utils/tokenCost';
import { formatAvailableQuota } from '../../utils/officialQuota';
import { useTokenCostDisplaySettings } from '../../hooks/useTokenCostDisplaySettings';
import styles from './index.module.less';

export function AvailableQuota({ account, language, settings }: {
  account?: OfficialAccountTotal; language: Language; settings: TokenCostDisplaySettings;
}) {
  const labels = officialUsageLabels(language);
  return <Tooltip title={labels.detail} styles={{ root: { maxWidth: 400 } }}>
    <span>{formatAvailableQuota(account, settings) ?? labels.unavailable}</span>
  </Tooltip>;
}

export function OfficialAccountUsage(props: {
  language: Language; refreshSeconds: number; startTs: number; refreshKey: number;
}) {
  const { language } = props;
  const settings = useTokenCostDisplaySettings();
  const { accounts, data, error, loading } = useOfficialUsage({ ...props, active: true });
  const labels = officialUsageLabels(language, settings.unit);
  const status = error ? 'unavailable' : data?.status;
  const columns = [
    { title: labels.account, dataIndex: 'accountLabel', key: 'account', width: 230 },
    { title: labels.devices, key: 'devices', width: 80, render: (_: unknown, row: OfficialAccountTotal) => row.devices.length },
    { title: labels.tokens, dataIndex: 'tokens', key: 'tokens', width: 130,
      render: (tokens: number) => formatTokens(tokens, language) },
    { title: labels.cost, dataIndex: 'costUsd', key: 'cost', width: 150,
      render: (cost: number) => formatEstimatedCost(cost, settings) },
    { title: labels.capacity, key: 'capacity', width: 220,
      render: (_: unknown, row: OfficialAccountTotal) => <QuotaCapacity account={row}
        language={language} settings={settings} /> },
    { title: labels.remaining, key: 'remaining', width: 200,
      render: (_: unknown, row: OfficialAccountTotal) => <AvailableQuota account={row}
        language={language} settings={settings} /> },
  ];
  return <section className={styles.tokenChartPanel}>
    <div className={styles.tokenChartHeading}><h2>{labels.title}</h2><span>{labels.hint}</span></div>
    <p role={status === 'unavailable' ? 'alert' : undefined}>
      {status && labels[status === 'unavailable' ? 'unavailableStatus' : status]}
    </p>
    <Table rowKey="accountId" size="small" loading={loading} dataSource={accounts} columns={columns}
      scroll={{ x: 1050 }} pagination={{ pageSize: 10, hideOnSinglePage: true }} locale={{ emptyText: labels.empty }}
      expandable={{ expandedRowRender: (account) => <Table rowKey="deviceId" size="small"
        dataSource={account.devices} pagination={false} columns={[
          { title: labels.devices, dataIndex: 'deviceName' },
          { title: labels.tokens, dataIndex: 'tokens', render: (tokens: number) => formatTokens(tokens, language) },
          { title: labels.cost, dataIndex: 'costUsd', render: (cost: number) => formatEstimatedCost(cost, settings) },
          { title: labels.updated, dataIndex: 'updatedAt', render: (ts: number) => new Date(ts * 1000).toLocaleString() },
        ]} /> }} />
  </section>;
}

function QuotaCapacity({ account, language, settings }: {
  account: OfficialAccountTotal; language: Language; settings: TokenCostDisplaySettings;
}) {
  const labels = officialUsageLabels(language);
  const windows = [{ key: 'primary' as const, quota: account.primary },
    { key: 'secondary' as const, quota: account.secondary }].filter(({ quota }) => quota);
  if (!windows.length) return <span>{labels.unavailable}</span>;
  return <>{windows.map(({ key, quota }) => <div key={key}>
    {windows.length > 1 && `${labels[key]}: `}
    {quota?.capacityUsd == null ? labels.unavailable : formatEstimatedCost(quota.capacityUsd, settings)}
  </div>)}</>;
}
