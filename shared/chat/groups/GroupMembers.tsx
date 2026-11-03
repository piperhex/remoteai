import { useMemo, useState } from 'react';
import { Button, Input, Select, Space, Table, Tag, theme } from 'antd';
import { CircleMinus } from 'lucide-react';
import type { GroupingUI } from './context';
import { groupOptions, groupPath, memberGroup, type GroupMember } from './model';
import { GroupMemberCards } from './GroupMemberCards';

export function GroupMembers({ model, mobile }: { model: GroupingUI; mobile: boolean }) {
  const t = model.translate;
  const { token } = theme.useToken();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [destination, setDestination] = useState('');
  const rows = useMemo(() => model.members.filter(member =>
    `${member.title} ${member.cwd}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [model.members, query]);
  const key = (member: GroupMember) => `${member.kind}:${member.id}`;
  const assign = async () => {
    if (await model.assign(model.members.filter(member => selected.includes(key(member))), destination || null)) {
      setSelected([]);
    }
  };
  return <div className="chat-group-members">
    <Input.Search allowClear value={query} onChange={event => setQuery(event.target.value)}
      placeholder={t('client.groups.search')} aria-label={t('client.groups.search')} />
    <Space wrap className="chat-group-batch">
      <span>{t('client.groups.selected', { count: selected.length })}</span>
      <Select className="chat-group-destination" value={destination} onChange={setDestination}
        aria-label={t('client.groups.move')} disabled={model.busy}
        options={[{ value: '', label: <Space style={{ color: token.colorError }}>
          <CircleMinus size={16} />{t('client.groups.remove')}</Space> }, ...groupOptions(model.grouping.groups)]} />
      <Button type="primary" disabled={!selected.length || !model.ready || model.loading}
        loading={model.busy} onClick={() => void assign()}>{t('client.groups.apply')}</Button>
      <Button loading={model.loading} onClick={() => void model.reload()}>{t('client.workspaceActions.refreshConversations')}</Button>
    </Space>
    {mobile ? <GroupMemberCards key={query} model={model} rows={rows} selected={selected} change={setSelected} />
      : <Table<GroupMember> size="small" rowKey={key} dataSource={rows} loading={model.loading}
      rowSelection={{ selectedRowKeys: selected, onChange: keys => setSelected(keys),
        getCheckboxProps: () => ({ disabled: model.busy || model.loading }) }}
      pagination={{ pageSize: 20, showSizeChanger: false }} scroll={{ x: 580 }} columns={[
        { title: t('client.groups.type'), width: 90, render: (_, row) =>
          t(row.kind === 'project' ? 'client.groups.project' : 'client.groups.thread') },
        { title: t('client.groups.title'), render: (_, row) => <div className="chat-group-member-name">
          <span>{row.title}</span>{row.archived && <Tag>{t('client.chat.archived')}</Tag>}<small>{row.cwd}</small></div> },
        { title: t('client.groups.groups'), width: 180, render: (_, row) => {
          const id = memberGroup(model.grouping, row);
          return <span>{id ? groupPath(model.grouping.groups, id) : t('client.groups.ungrouped')}</span>;
        } },
      ]} />}
  </div>;
}
