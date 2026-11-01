import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Input, InputNumber, Popconfirm, Select, Space, Spin, Tag } from 'antd';
import { useI18n } from '../i18n-context';
import { marketError, marketText, type MarketKey, type MarketText } from '../../../../shared/provider-market/i18n';
import type { MarketDraft, MarketItem, MarketPage } from '../../../../shared/provider-market/types';
import { MarketEditor } from '../../../../shared/provider-market/MarketEditor';
import { MarketDetail } from '../../../../shared/provider-market/MarketDetail';
import { parseItem } from '../../../../shared/provider-market/validation';
import { MarketBadgeTag, MarketStatus } from '../../../../shared/provider-market/MarketStatus';
import { ProviderMarketReview } from './ProviderMarketReview';
import { ProviderMarketBadgeEditor } from './ProviderMarketBadgeEditor';
import '../../../../shared/provider-market/market.css';

const ENDPOINT = '/admin/api/provider-market';
interface Props {
  api: <T>(path: string, options?: RequestInit) => Promise<T>;
  canManage: boolean;
  canOrder: boolean;
  canReview?: boolean;
  canPromote?: boolean;
}
function OrderEditor({ item, disabled, save, t }: {
  item: MarketItem; disabled: boolean; save: (order: number | null) => Promise<void>; t: MarketText;
}) {
  const [value, setValue] = useState(item.sortOrder);
  return <Space wrap><InputNumber min={0} max={1_000_000} precision={0} value={value}
    disabled={disabled} aria-label={t('market.manualOrder')} placeholder={t('market.manualOrder')}
    onChange={setValue} />
    <Button disabled={disabled} onClick={() => void save(value)}>{t('market.saveOrder')}</Button>
    <Button disabled={disabled || item.sortOrder === null} onClick={() => void save(null)}>
      {t('market.clearOrder')}</Button></Space>;
}
export function ProviderMarketPage({ api, canManage, canOrder, canReview = false, canPromote = false }: Props) {
  const { language } = useI18n();
  const t = useMemo(() => marketText(language), [language]);
  const [data, setData] = useState<MarketPage>({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [reviewStatus, setReviewStatus] = useState('all');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MarketKey | null>(null);
  const [editing, setEditing] = useState<MarketItem | 'new' | null>(null);
  const [selected, setSelected] = useState<MarketItem | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    const query = new URLSearchParams({ page: String(page), search, reviewStatus });
    void api<MarketPage>(`${ENDPOINT}?${query}`).then((result) => {
      const items = result.items.map(parseItem);
      if (active) setData({ ...result, items });
    }).catch((reason) => { if (active) setError(marketError(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, page, search, reviewStatus, refresh, t]);
  const mutate = async (path: string, method: string, body: unknown) => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(null);
    try {
      await api(path, { method, body: JSON.stringify(body) });
      setEditing(null); setSelected(null); setRefresh((value) => value + 1);
      return true;
    } catch (reason) { setError(marketError(reason)); return false; }
    finally { lock.current = false; setBusy(false); }
  };
  const save = async (draft: MarketDraft, published: boolean) => {
    const current = editing && editing !== 'new' ? editing : null;
    await mutate(`${ENDPOINT}${current ? `/${current.id}` : ''}`, current ? 'PUT' : 'POST', {
      draft, published, revision: current?.revision ?? 0,
    });
  };
  return <div className="provider-market">
    <h2>{t('market.title')}</h2><p>{t('market.adminIntro')}</p>
    {error && <Alert type="error" message={t(error)} action={<Button disabled={busy}
      onClick={() => {
        if (error === 'market.conflict') { setEditing(null); setSelected(null); }
        setRefresh((value) => value + 1);
      }}>{t('market.retry')}</Button>} />}
    {editing ? <MarketEditor initial={editing === 'new' ? undefined : editing} t={t} busy={busy} requiresReview={false}
      onSave={save} onCancel={() => setEditing(null)} /> : selected ? <>
      <Button onClick={() => setSelected(null)}>{t('market.back')}</Button>
      <MarketDetail item={selected} t={t} />
      <MarketStatus item={selected} t={t} />
      {selected.reviewReason && <p>{t('market.reviewReasonValue', { reason: selected.reviewReason })}</p>}
      {canReview && <ProviderMarketReview key={`${selected.id}:${selected.revision}`} item={selected} busy={busy} t={t}
        onReview={(decision, reason) => mutate(`${ENDPOINT}/${selected.id}/review`, 'PATCH', {
          revision: selected.revision, decision, reason,
        })} />}
    </> : <>
      <div className="pm-toolbar"><Input.Search placeholder={t('market.search')} aria-label={t('market.search')}
        style={{ maxWidth: 360 }} onSearch={(value) => { setSearch(value); setPage(1); }} />
        {canManage && <Button type="primary" disabled={busy}
          onClick={() => setEditing('new')}>{t('market.publish')}</Button>}</div>
      <Select aria-label={t('market.reviewFilter')} value={reviewStatus} style={{ width: 220, maxWidth: '100%' }}
        onChange={value => { setReviewStatus(value); setPage(1); }} options={[
          { value: 'all', label: t('market.all') }, { value: 'pending', label: t('market.reviewPending') },
          { value: 'approved', label: t('market.reviewApproved') }, { value: 'rejected', label: t('market.reviewRejected') },
          { value: 'draft', label: t('market.unpublished') },
        ]} />
      {loading ? <Spin /> : data.items.map((item) => <section className="pm-card" key={item.id}>
        <div className="pm-admin-card-header"><button className="pm-card-title" onClick={() => setSelected(item)}>
          {item.name}</button><MarketBadgeTag badge={item.marketingBadge} /></div>
        <Space wrap><Tag>{t(item.official ? 'market.official' : 'market.community')}</Tag>
          <MarketStatus item={item} t={t} />
          <span>{t('market.users', { count: item.userCount })}</span></Space>
        {canReview && !item.official && item.published && item.reviewStatus === 'pending' &&
          <Button disabled={busy} onClick={() => setSelected(item)}>{t('market.reviewEntry')}</Button>}
        {canManage && item.official && <Space>
          <Button disabled={busy} onClick={() => setEditing(item)}>{t('market.edit')}</Button>
          <Popconfirm title={t('market.deleteConfirm')} overlayStyle={{ maxWidth: 400 }}
            okText={t('market.confirmDelete')} cancelText={t('market.cancel')}
            onConfirm={() => mutate(`${ENDPOINT}/${item.id}`, 'DELETE', { revision: item.revision })}>
            <Button danger disabled={busy}>{t('market.remove')}</Button></Popconfirm></Space>}
        {canOrder && <OrderEditor key={`${item.id}:${item.revision}`} item={item} disabled={busy} t={t}
          save={async (sortOrder) => { await mutate(`${ENDPOINT}/${item.id}/order`, 'PATCH', {
            sortOrder, revision: item.revision,
          }); }} />}
        {canPromote && <ProviderMarketBadgeEditor key={`badge:${item.id}:${item.revision}`}
          badge={item.marketingBadge} busy={busy} t={t} onSave={badge => mutate(`${ENDPOINT}/${item.id}/badge`,
            'PATCH', { revision: item.revision, badge })} />}
      </section>)}
      <Space><Button disabled={page === 1 || loading} onClick={() => setPage(page - 1)}>{t('market.previous')}</Button>
        <Button disabled={page * 40 >= data.total || loading} onClick={() => setPage(page + 1)}>{t('market.next')}</Button>
      </Space>
    </>}
  </div>;
}
