import { Spin, Tooltip } from 'antd';
import type { Language } from '../../i18n';
import type { OfficialAccountTotal } from '../../../../../shared/officialUsage';
import { officialUsageLabels } from '@remoteai/i18n/copy/client/officialUsageLabels';
import { useOfficialUsage } from '../../hooks/useOfficialUsage';
import { OfficialUsageChart } from '../../../../../shared/token-usage/OfficialUsageChart';
import { formatEstimatedCost, type TokenCostDisplaySettings } from '../../utils/tokenCost';
import { formatAvailableQuota } from '../../utils/officialQuota';
import { useTokenCostDisplaySettings } from '../../hooks/useTokenCostDisplaySettings';
import styles from './index.module.less';
import { useViewActive } from '../../../../../shared/RetainedView';

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
  const active = useViewActive();
  const { accounts, data, error, loading } = useOfficialUsage({ ...props, active });
  const labels = officialUsageLabels(language, settings.unit);
  const status = error ? 'unavailable' : data?.status;
  return <section className={styles.tokenChartPanel}>
    <div className={styles.tokenChartHeading}><h2>{labels.title}</h2><span>{labels.hint}</span></div>
    <p role={status === 'unavailable' ? 'alert' : undefined}>
      {status && labels[status === 'unavailable' ? 'unavailableStatus' : status]}
    </p>
    <Spin spinning={loading}><OfficialUsageChart accounts={accounts} language={language} unit={settings.unit}
      formatCost={(cost) => formatEstimatedCost(cost, settings)}
      formatAvailable={(account) => formatAvailableQuota(account, settings)} /></Spin>
  </section>;
}
