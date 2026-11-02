import { useState, type Key } from 'react';
import { Button, Card, Checkbox, Spin, Tag } from 'antd';
import type { GroupingUI } from './context';
import { groupPath, memberGroup, type GroupMember } from './model';

const PAGE_SIZE = 40;
const memberKey = (member: GroupMember) => `${member.kind}:${member.id}`;

export function GroupMemberCards({ model, rows, selected, change }: {
  model: GroupingUI; rows: GroupMember[]; selected: Key[]; change: (keys: Key[]) => void;
}) {
  const t = model.translate;
  const [limit, setLimit] = useState(PAGE_SIZE);
  const allSelected = rows.length > 0 && rows.every(row => selected.includes(memberKey(row)));
  const toggle = (key: string) => change(selected.includes(key)
    ? selected.filter(value => value !== key) : [...selected, key]);
  return <Spin spinning={model.loading}><div className="chat-group-cards">
    <Checkbox checked={allSelected} disabled={model.busy || model.loading || !rows.length}
      indeterminate={!allSelected && rows.some(row => selected.includes(memberKey(row)))}
      onChange={() => change(allSelected ? [] : rows.map(memberKey))}>{t('client.groups.selectAll')}</Checkbox>
    {rows.slice(0, limit).map(row => {
      const id = memberGroup(model.grouping, row);
      const checked = selected.includes(memberKey(row));
      return <Card key={memberKey(row)} size="small" className="chat-group-card" data-selected={checked}>
        <Checkbox checked={checked} disabled={model.busy || model.loading}
          aria-label={t('client.groups.select', { name: row.title })} onChange={() => toggle(memberKey(row))}>
          <strong>{row.title}</strong></Checkbox>
        <div className="chat-group-card-detail">
          <Tag>{t(row.kind === 'project' ? 'client.groups.project' : 'client.groups.thread')}</Tag>
          {row.archived && <Tag>{t('client.chat.archived')}</Tag>}
        </div>
        <small className="chat-group-card-path">{row.cwd}</small>
        <div className="chat-group-card-detail"><span>{t('client.groups.groups')}</span>
          <span>{id ? groupPath(model.grouping.groups, id) : t('client.groups.ungrouped')}</span></div>
      </Card>;
    })}
    {rows.length > limit && <Button onClick={() => setLimit(current => current + PAGE_SIZE)}>
      {t('client.chat.showMore.83ad87')}</Button>}
  </div></Spin>;
}
