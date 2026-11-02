import type { Key } from 'react';
import { useRef, useState } from 'react';
import { Button, InputNumber, Popconfirm, Space, Table, Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import type { MarketItem, MarketPage } from '../../../../shared/provider-market/types';
import type { MarketText } from '../../../../shared/provider-market/i18n';
import { MarketBadgeTag, MarketStatus } from '../../../../shared/provider-market/MarketStatus';
import { ProviderMarketBadgeEditor } from './ProviderMarketBadgeEditor';

export type MarketMutation = (path: string, method: string, body: unknown) => Promise<boolean>;
export const MARKET_ENDPOINT = '/admin/api/provider-market';
export const MARKET_PAGE_SIZE = 40;
const MARKET_PAGE_SIZES = [10, 20, MARKET_PAGE_SIZE, 50, 100];
export const isPendingReview = (item: MarketItem) =>
  !item.official && item.published && item.reviewStatus === 'pending';

interface Props {
  data: MarketPage; page: number; pageSize: number; loading: boolean; busy: boolean; t: MarketText;
  canManage: boolean; canReview: boolean; canOrder: boolean; canPromote: boolean;
  selectedKeys: Key[]; onSelection: (keys: Key[]) => void; onPage: (page: number, pageSize: number) => void;
  onView: (item: MarketItem) => void; onEdit: (item: MarketItem) => void; mutate: MarketMutation;
}

function OrderEditor({ item, busy, t, mutate }: {
  item: MarketItem; busy: boolean; t: MarketText; mutate: MarketMutation;
}) {
  const [value, setValue] = useState(item.sortOrder);
  const draft = useRef(item.sortOrder);
  const saving = useRef(false);
  const change = (next: number | null) => { draft.current = next; setValue(next); };
  const save = async () => {
    const sortOrder = draft.current;
    if (busy || saving.current || sortOrder === item.sortOrder) return;
    saving.current = true;
    try {
      const saved = await mutate(`${MARKET_ENDPOINT}/${item.id}/order`, 'PATCH', {
        sortOrder, revision: item.revision,
      });
      if (!saved) change(item.sortOrder);
    } finally {
      saving.current = false;
    }
  };
  // Let InputNumber normalize precision and bounds before its blur reaches this wrapper.
  return <div onBlur={() => void save()}>
    <InputNumber min={0} max={1_000_000} precision={0} value={value} disabled={busy} size="small"
      aria-label={t('market.editOrder', { name: item.name })} placeholder={t('market.automaticOrder')}
      onChange={change} style={{ width: '100%' }} />
  </div>;
}

function RowActions({ item, props }: { item: MarketItem; props: Props }) {
  const { t, busy, canManage, canReview, canPromote, mutate, onView, onEdit } = props;
  return <Space wrap size={4}>
    <Button size="small" onClick={() => onView(item)} disabled={busy}>
      {t(canReview && isPendingReview(item) ? 'market.reviewEntry' : 'market.viewDetails')}</Button>
    {canManage && item.official && <Button size="small" disabled={busy} onClick={() => onEdit(item)}>
      {t('market.edit')}</Button>}
    {canPromote && <ProviderMarketBadgeEditor key={`badge:${item.id}:${item.revision}`}
      badge={item.marketingBadge} busy={busy} t={t} onSave={badge => mutate(`${MARKET_ENDPOINT}/${item.id}/badge`,
        'PATCH', { revision: item.revision, badge })} />}
    {canManage && <Popconfirm title={t('market.deleteConfirm')} overlayStyle={{ maxWidth: 400 }}
      okText={t('market.confirmDelete')} cancelText={t('market.cancel')}
      onConfirm={() => mutate(`${MARKET_ENDPOINT}/${item.id}`, 'DELETE', { revision: item.revision })}>
      <Button size="small" danger disabled={busy}>{t('market.remove')}</Button></Popconfirm>}
  </Space>;
}

export function ProviderMarketTable(props: Props) {
  const { t, data, page, pageSize, loading, busy, canManage, canReview, canOrder, selectedKeys } = props;
  const columns: TableColumnsType<MarketItem> = [
    { title: t('market.name'), key: 'name', width: '26%', render: (_, item) =>
      <div className="pm-admin-name"><Button type="link" disabled={busy} onClick={() => props.onView(item)}>
        {item.name}</Button><MarketBadgeTag badge={item.marketingBadge} />
        <span className="pm-admin-address">{item.baseUrl}</span></div> },
    { title: t('market.source'), key: 'source', width: '12%', render: (_, item) =>
      <Tag color={item.official ? 'blue' : undefined}>
        {t(item.official ? 'market.official' : 'market.community')}</Tag> },
    { title: t('market.reviewFilter'), key: 'status', width: '12%',
      render: (_, item) => <MarketStatus item={item} t={t} /> },
    { title: t('market.userCount'), dataIndex: 'userCount', width: '9%', align: 'right' },
    { title: t('market.displayOrder'), key: 'order', width: '15%', render: (_, item) => canOrder
      ? <OrderEditor key={`${item.id}:${item.revision}`} item={item} busy={busy || loading} t={t}
        mutate={props.mutate} />
      : item.sortOrder ?? t('market.automaticOrder') },
    { title: t('market.actions'), key: 'actions', width: '26%',
      render: (_, item) => <RowActions item={item} props={props} /> },
  ];
  return <Table<MarketItem> className="pm-admin-table" rowKey="id" columns={columns}
    dataSource={data.items} loading={loading} tableLayout="fixed"
    size="middle" scroll={{ y: '100%' }} locale={{ emptyText: t('market.empty') }}
    rowSelection={canManage || canReview ? { columnWidth: 40,
      selectedRowKeys: selectedKeys, onChange: props.onSelection,
      getTitleCheckboxProps: () => ({ 'aria-label': t('market.selectPage'), disabled: busy || loading }),
      getCheckboxProps: item => ({ disabled: busy || loading || (!canManage && !isPendingReview(item)),
        'aria-label': t('market.selectItem', { name: item.name }) }),
    } : undefined}
    pagination={{ current: page, pageSize, total: data.total, showSizeChanger: true,
      pageSizeOptions: MARKET_PAGE_SIZES,
      disabled: busy || loading, onChange: props.onPage,
      showTotal: total => t('market.totalItems', { count: total }), hideOnSinglePage: false }} />;
}
