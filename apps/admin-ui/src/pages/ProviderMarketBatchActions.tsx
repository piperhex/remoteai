import { useState } from 'react';
import { Alert, Button, Input, Modal, Space } from 'antd';
import type { MarketItem } from '../../../../shared/provider-market/types';
import type { MarketKey, MarketText } from '../../../../shared/provider-market/i18n';
import { isPendingReview, MARKET_ENDPOINT, type MarketMutation } from './ProviderMarketTable';

type BatchAction = 'approved' | 'rejected' | 'delete';
interface Props {
  items: MarketItem[]; busy: boolean; canManage: boolean; canReview: boolean; t: MarketText;
  error: MarketKey | null; mutate: MarketMutation; onClear: () => void;
}

export function ProviderMarketBatchActions({ items, busy, canManage, canReview, t, error, mutate, onClear }: Props) {
  const [action, setAction] = useState<BatchAction | null>(null);
  const [reason, setReason] = useState('');
  const canBatchReview = items.length > 0 && items.every(isPendingReview);
  const title = action === 'delete' ? 'market.batchDelete' :
    action === 'rejected' ? 'market.batchReject' : 'market.batchApprove';
  const submit = async () => {
    if (!action || !items.length || (action !== 'delete' && !canBatchReview)) return;
    const entries = items.map(({ id, revision }) => ({ id, revision }));
    const ok = await mutate(`${MARKET_ENDPOINT}/batch/${action === 'delete' ? 'delete' : 'review'}`, 'POST',
      action === 'delete' ? { items: entries } : { items: entries, decision: action, reason: reason.trim() });
    if (ok) { setAction(null); setReason(''); }
  };
  const open = (next: BatchAction) => { setReason(''); setAction(next); };
  if (!canManage && !canReview) return null;
  return <>
    <div className="pm-admin-batch">
      <Space wrap><strong>{t('market.selectedCount', { count: items.length })}</strong>
        {canReview && <><Button disabled={busy || !canBatchReview} onClick={() => open('approved')}>
          {t('market.batchApprove')}</Button>
          <Button disabled={busy || !canBatchReview} onClick={() => open('rejected')}>
            {t('market.batchReject')}</Button></>}
        {canManage && <Button danger disabled={busy || !items.length} onClick={() => open('delete')}>
          {t('market.batchDelete')}</Button>}
        {items.length > 0 && <Button type="link" disabled={busy} onClick={onClear}>
          {t('market.clearSelection')}</Button>}
      </Space>
      <span>{t(items.length > 0 && canReview && !canBatchReview ? 'market.batchReviewEligibility' :
        'market.selectionHint')}</span>
    </div>
    <Modal title={t(title)} open={action !== null} width={448} closable={!busy} maskClosable={!busy}
      keyboard={!busy} onCancel={() => setAction(null)} onOk={() => void submit()}
      okText={t(title)} cancelText={t('market.cancel')} confirmLoading={busy}
      cancelButtonProps={{ disabled: busy }} okButtonProps={{ danger: action !== 'approved', 'aria-label': t(title),
        disabled: !items.length || (action === 'rejected' && !reason.trim()) }}>
      <div style={{ maxWidth: 400 }}>
        <p>{t(action === 'delete' ? 'market.batchDeleteConfirm' : 'market.batchReviewConfirm',
          { count: items.length })}</p>
        {action === 'rejected' && <label><span>{t('market.reviewReason')}</span>
          <Input.TextArea aria-label={t('market.reviewReason')} rows={3} maxLength={400} value={reason}
            disabled={busy} onChange={event => setReason(event.target.value)} /></label>}
        {error && <Alert type="error" showIcon message={t(error)} />}
      </div>
    </Modal>
  </>;
}
