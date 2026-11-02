import { Button, Input, Segmented, Space } from 'antd';
import type { MarketText } from './i18n';
import type { useMarket } from './useMarket';
import { PublicProviderImport } from './PublicProviderImport';

export function MarketToolbar({ market, t }: { market: ReturnType<typeof useMarket>; t: MarketText }) {
  return <div className="pm-market-controls">
    <div className="pm-toolbar"><Segmented value={market.scope} disabled={market.busy}
      options={(['all', 'official', 'community', 'mine'] as const)
        .map((value) => ({ value, label: t(`market.${value}`) }))}
      onChange={(value) => market.selectScope(value as typeof market.scope)} /></div>
    <div className="pm-toolbar pm-search-toolbar">
      <Input.Search aria-label={t('market.search')} placeholder={t('market.search')}
        allowClear onSearch={market.find} maxLength={160} />
      <Space className="pm-search-actions" wrap>
        <PublicProviderImport t={t} disabled={market.busy} select={market.setSelected}
          fail={() => market.setError('market.invalid')} />
        <Button type="primary" disabled={market.busy} onClick={() => market.identity
          ? market.setEditor('new') : market.setError('market.signIn')}>{t('market.publish')}</Button>
      </Space>
    </div>
  </div>;
}
