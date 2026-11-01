import { useState } from 'react';
import { Alert, Button, Input, Space } from 'antd';
import type { MarketItem } from '../../../../shared/provider-market/types';
import type { MarketText } from '../../../../shared/provider-market/i18n';

export function ProviderMarketReview({ item, busy, t, onReview }: {
  item: MarketItem; busy: boolean; t: MarketText;
  onReview: (decision: 'approved' | 'rejected', reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  if (item.official || !item.published || item.reviewStatus === 'rejected') return null;
  return <section className="pm-editor-section">
    <Alert type="info" showIcon message={t('market.reviewInstructions')} />
    <label style={{ maxWidth: 400 }}><span>{t('market.reviewReason')}</span>
      <Input.TextArea aria-label={t('market.reviewReason')} value={reason} rows={3} maxLength={400}
        disabled={busy} onChange={event => setReason(event.target.value)} /></label>
    <Space wrap>
      {item.reviewStatus === 'pending' && <Button type="primary" loading={busy}
        onClick={() => void onReview('approved', '')}>{t('market.approve')}</Button>}
      <Button danger aria-label={t('market.reject')} disabled={busy || !reason.trim()}
        onClick={() => void onReview('rejected', reason.trim())}>
        {t('market.reject')}</Button>
    </Space>
  </section>;
}
