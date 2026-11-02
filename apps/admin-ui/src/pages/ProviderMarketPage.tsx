import { useEffect, useMemo, useRef, useState, type CSSProperties, type Key } from 'react';
import { Alert, Button, Input, Select, Space, theme } from 'antd';
import { useI18n } from '../i18n-context';
import { marketError, marketText, type MarketKey } from '../../../../shared/provider-market/i18n';
import type { MarketDraft, MarketItem, MarketPage } from '../../../../shared/provider-market/types';
import { MarketEditor } from '../../../../shared/provider-market/MarketEditor';
import { MarketDetail } from '../../../../shared/provider-market/MarketDetail';
import { parseItem } from '../../../../shared/provider-market/validation';
import { MarketStatus } from '../../../../shared/provider-market/MarketStatus';
import { ProviderMarketReview } from './ProviderMarketReview';
import { ProviderMarketTable, MARKET_ENDPOINT as ENDPOINT, MARKET_PAGE_SIZE } from './ProviderMarketTable';
import { ProviderMarketBatchActions } from './ProviderMarketBatchActions';
import '../../../../shared/provider-market/market.css';
import './ProviderMarketPage.css';

interface Props {
  api: <T>(path: string, options?: RequestInit) => Promise<T>;
  canManage: boolean;
  canOrder: boolean;
  canReview?: boolean;
  canPromote?: boolean;
}
export function ProviderMarketPage({ api, canManage, canOrder, canReview = false, canPromote = false }: Props) {
  const { language } = useI18n();
  const { token } = theme.useToken();
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
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    const query = new URLSearchParams({ page: String(page), search, reviewStatus });
    void api<MarketPage>(`${ENDPOINT}?${query}`).then((result) => {
      const items = result.items.map(parseItem);
      if (active) {
        setData({ ...result, items });
        setSelectedKeys([]);
        setPage(current => Math.min(current, Math.max(1, Math.ceil(result.total / MARKET_PAGE_SIZE))));
      }
    }).catch((reason) => { if (active) setError(marketError(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, page, search, reviewStatus, refresh]);
  const mutate = async (path: string, method: string, body: unknown) => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(null);
    try {
      await api(path, { method, body: JSON.stringify(body) });
      setSelectedKeys([]);
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
  const changePage = (next: number) => { setSelectedKeys([]); setPage(next); };
  return <div className="provider-market pm-admin-market" style={{ '--muted': token.colorTextSecondary,
    '--border': token.colorBorderSecondary, '--panel': token.colorBgContainer } as CSSProperties}>
    <h2>{t('market.title')}</h2><p>{t('market.adminIntro')}</p>
    {error && <Alert type="error" message={t(error)} action={<Button disabled={busy}
      onClick={() => {
        if (error === 'market.conflict') { setEditing(null); setSelected(null); }
        setRefresh((value) => value + 1);
      }}>{t('market.retry')}</Button>} />}
    {editing ? <MarketEditor initial={editing === 'new' ? undefined : editing} t={t} busy={busy} requiresReview={false}
      onSave={save} onCancel={() => setEditing(null)} /> : selected ? <>
      <Button disabled={busy} onClick={() => setSelected(null)}>{t('market.back')}</Button>
      <MarketDetail item={selected} t={t} />
      <MarketStatus item={selected} t={t} />
      {selected.reviewReason && <p>{t('market.reviewReasonValue', { reason: selected.reviewReason })}</p>}
      {canReview && <ProviderMarketReview key={`${selected.id}:${selected.revision}`} item={selected} busy={busy} t={t}
        onReview={(decision, reason) => mutate(`${ENDPOINT}/${selected.id}/review`, 'PATCH', {
          revision: selected.revision, decision, reason,
        })} />}
    </> : <>
      <div className="pm-toolbar"><Space wrap>
        <Input.Search placeholder={t('market.search')} aria-label={t('market.search')} disabled={busy}
          style={{ width: 320, maxWidth: '100%' }}
          onSearch={(value) => { setSearch(value); changePage(1); }} />
        <Select aria-label={t('market.reviewFilter')} value={reviewStatus} disabled={busy}
          style={{ width: 180, maxWidth: '100%' }}
          onChange={value => { setReviewStatus(value); changePage(1); }} options={[
            { value: 'all', label: t('market.all') }, { value: 'pending', label: t('market.reviewPending') },
            { value: 'approved', label: t('market.reviewApproved') },
            { value: 'rejected', label: t('market.reviewRejected') },
            { value: 'draft', label: t('market.unpublished') },
          ]} />
        </Space>
        {canManage && <Button type="primary" disabled={busy}
          onClick={() => setEditing('new')}>{t('market.publish')}</Button>}</div>
      <ProviderMarketBatchActions items={data.items.filter(item => selectedKeys.includes(item.id))}
        busy={busy || loading} canManage={canManage} canReview={canReview} t={t} error={error}
        mutate={mutate} onClear={() => setSelectedKeys([])} />
      <ProviderMarketTable data={data} page={page} loading={loading} busy={busy} t={t}
        canManage={canManage} canReview={canReview} canOrder={canOrder} canPromote={canPromote}
        selectedKeys={selectedKeys} onSelection={setSelectedKeys} onPage={changePage}
        onView={setSelected} onEdit={setEditing} mutate={mutate} />
    </>}
  </div>;
}
