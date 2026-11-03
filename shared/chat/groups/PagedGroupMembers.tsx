import { useEffect, useState, type Key } from 'react';
import { Alert, Button, Empty, Input, Pagination, Select, Space, Table, Tag, theme } from 'antd';
import { CircleMinus } from 'lucide-react';
import type { GroupingUI } from './context';
import { groupOptions, groupPath, memberGroup, type GroupMember, type GroupTarget } from './model';
import { GROUP_PAGE_SIZES } from './memberPaging';
import { usePagedGroupMembers } from './usePagedGroupMembers';

export function PagedGroupMembers({ model }: { model: GroupingUI }) {
  const t = model.translate;
  const { token } = theme.useToken();
  const data = usePagedGroupMembers(model);
  const [selected, setSelected] = useState<Key[]>([]);
  const [destination, setDestination] = useState('');
  useEffect(() => { setSelected([]); }, [model.client]);
  const assign = async () => {
    const targets: GroupTarget[] = selected.map(value => {
      const key = String(value);
      return { kind: key.startsWith('project:') ? 'project' : 'thread', id: key.slice(key.indexOf(':') + 1) };
    });
    if (await model.assign(targets, destination || null)) setSelected([]);
  };
  const disabled = model.busy || data.loading || !model.ready;
  return <div className="chat-group-members chat-group-members-paged">
    <Input.Search allowClear value={data.query} onChange={event => data.setQuery(event.target.value)}
      maxLength={1000} placeholder={t('client.groups.search')} aria-label={t('client.groups.search')} />
    <Space wrap className="chat-group-batch">
      <span>{t('client.groups.selected', { count: selected.length })}</span>
      <Select className="chat-group-destination" value={destination} onChange={setDestination}
        aria-label={t('client.groups.move')} disabled={model.busy}
        options={[{ value: '', label: <Space style={{ color: token.colorError }}>
          <CircleMinus size={16} />{t('client.groups.remove')}</Space> }, ...groupOptions(model.grouping.groups)]} />
      <Button type="primary" disabled={!selected.length || disabled} loading={model.busy}
        onClick={() => void assign()}>{t('client.groups.apply')}</Button>
      <Button loading={data.loading} disabled={model.busy || !model.ready} onClick={data.reload}>
        {t('client.workspaceActions.refreshConversations')}</Button>
    </Space>
    {data.error && <Alert type="error" showIcon message={t(data.error as Parameters<typeof t>[0])} />}
    <div className="chat-group-table-scroll chat-group-members-table" ref={data.viewport}>
      <Table<GroupMember> size="small" rowKey={row => `${row.kind}:${row.id}`} tableLayout="fixed"
        dataSource={data.result?.data ?? []} loading={data.loading} pagination={false}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t(data.query.trim() ? 'client.groups.noMatchingMembers' : 'client.groups.emptyMembers')} /> }}
        rowSelection={{ selectedRowKeys: selected, preserveSelectedRowKeys: true,
          onChange: keys => setSelected(keys), getCheckboxProps: row =>
            ({ disabled, 'aria-label': t('client.groups.select', { name: row.title }) }) }} columns={[
          { title: t('client.groups.type'), width: 120, render: (_, row) =>
            t(row.kind === 'project' ? 'client.groups.project' : 'client.groups.thread') },
          { title: t('client.groups.title'), render: (_, row) => <div className="chat-group-member-name">
            <span>{row.title}</span>{row.archived && <Tag>{t('client.chat.archived')}</Tag>}
            <small>{row.cwd}</small></div> },
          { title: t('client.groups.groups'), width: 180, render: (_, row) => {
            const id = memberGroup(model.grouping, row);
            return <span>{id ? groupPath(model.grouping.groups, id) : t('client.groups.ungrouped')}</span>;
          } },
        ]} />
    </div>
    <div className="chat-group-members-footer">
      <span aria-live="polite">{t('client.groups.totalMembers', { count: data.result?.total ?? 0 })}</span>
      <div className="chat-group-members-pagination">
        <Pagination current={data.page} pageSize={data.pageSize} total={data.result?.total ?? 0}
          onChange={page => data.changePage(page, data.pageSize)} showSizeChanger={false}
          disabled={disabled || Boolean(data.error)} showLessItems />
        <Select aria-label={t('client.groups.pageSize')} value={data.pageSize} disabled={disabled}
          onChange={size => data.changePage(1, size)} options={GROUP_PAGE_SIZES.map(count =>
            ({ value: count, label: t('client.groups.itemsPerPage', { count }) }))} />
      </div>
    </div>
  </div>;
}
