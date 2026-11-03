import { useMemo, useState } from 'react';
import { Button, Input, Select, Space, theme } from 'antd';
import { CircleMinus } from 'lucide-react';
import type { GroupingUI } from './context';
import { groupOptions, type GroupMember } from './model';
import { GroupMemberCards } from './GroupMemberCards';

export function GroupMembers({ model }: { model: GroupingUI }) {
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
    <GroupMemberCards key={query} model={model} rows={rows} selected={selected} change={setSelected} />
  </div>;
}
