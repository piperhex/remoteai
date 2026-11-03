import { useMemo, useState } from 'react';
import { Button, Checkbox, Input, Table } from 'antd';
import { ChevronDown, ChevronRight, Folder, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { GroupingUI } from './context';
import { groupPath, type ChatGroup } from './model';
import { GroupIcon } from './GroupIcon';
import { groupManagerRows, type GroupManagerRow } from './managerRows';

export function GroupTable({ model, edit, remove }: {
  model: GroupingUI; edit: (group: ChatGroup | 'new') => void; remove: (groups: ChatGroup[]) => void;
}) {
  const t = model.translate;
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = useMemo(() => groupManagerRows(model.grouping, query, collapsed), [model.grouping, query, collapsed]);
  const selection = model.grouping.groups.filter(group => selected.includes(group.id));
  const selectionLabel = t('client.groups.selected', { count: '{count}' }).split('{count}');
  const selectedIds = selection.map(group => group.id);
  const checked = rows.length > 0 && rows.every(group => selectedIds.includes(group.id));
  const indeterminate = !checked && rows.some(group => selectedIds.includes(group.id));
  const disabled = model.busy || !model.ready;
  const selectAll = (check: boolean) => setSelected(check
    ? [...new Set([...selectedIds, ...rows.map(group => group.id)])]
    : selectedIds.filter(id => !rows.some(group => group.id === id)));
  const toggle = (id: string) => setCollapsed(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const all = <Checkbox checked={checked} indeterminate={indeterminate} disabled={disabled || !rows.length}
    aria-label={t('client.groups.selectAll')} onChange={event => selectAll(event.target.checked)} />;
  return <div className="chat-group-table-panel">
    <div className="chat-group-toolbar">
      <div className="chat-group-selection">
        {all}<span aria-live="polite">{selectionLabel[0]}<strong>{selection.length}</strong>{selectionLabel[1]}</span>
        <Button danger className="chat-group-delete" icon={<Trash2 size={18} />}
          disabled={disabled || !selection.length} onClick={() => remove(selection)}>
          {t('client.groups.batchDelete')}</Button>
      </div>
      <div className="chat-group-tools">
        <Input allowClear prefix={<Search size={18} aria-hidden="true" />} value={query}
          placeholder={t('client.groups.searchGroups')} aria-label={t('client.groups.searchGroups')}
          onChange={event => setQuery(event.target.value)} />
        <Button type="primary" icon={<Plus size={20} />} disabled={disabled}
          onClick={() => edit('new')}>{t('client.groups.create')}</Button>
      </div>
    </div>
    <div className="chat-group-table-scroll">
      <Table<GroupManagerRow> rowKey="id" dataSource={rows} pagination={false} tableLayout="fixed"
        locale={{ emptyText: t(query.trim() ? 'client.groups.noResults' : 'client.groups.empty') }}
        rowSelection={{ selectedRowKeys: selectedIds, onChange: setSelected, columnWidth: 56,
          preserveSelectedRowKeys: true, columnTitle: all,
          getCheckboxProps: group => ({ disabled, 'aria-label': t('client.groups.select', { name: group.name }) }) }}
        columns={[
          { title: t('client.groups.name'), key: 'name', render: (_, group) => {
            const expanded = Boolean(query.trim()) || !collapsed.has(group.id);
            return <div className="chat-group-table-name" style={{ paddingInlineStart: group.depth * 28 }}>
              {group.hasChildren ? <button type="button" className="chat-group-expand" aria-expanded={expanded}
                disabled={Boolean(query.trim())} onClick={() => toggle(group.id)}
                aria-label={t(expanded ? 'client.groups.collapse' : 'client.groups.expand', { name: group.name })}>
                {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              </button> : <span className="chat-group-expand-spacer" />}
              {group.icon ? <GroupIcon icon={group.icon} size={22} /> : <Folder size={22} aria-hidden="true" />}
              <span>{group.name}</span>
            </div>;
          } },
          { title: t('client.groups.projectCount'), dataIndex: 'projectCount', width: '15%' },
          { title: t('client.groups.parent'), width: '24%', render: (_, group) => group.parentId
            ? groupPath(model.grouping.groups, group.parentId) : <span aria-label={t('client.groups.root')}>—</span> },
          { title: t('client.groups.actions'), width: 120, key: 'actions', render: (_, group) =>
            <div className="chat-group-row-actions">
              <Button icon={<Pencil size={18} />} aria-label={t('client.groups.edit')} disabled={disabled}
                onClick={() => edit(group)} />
              <Button danger className="chat-group-delete" icon={<Trash2 size={18} />}
                aria-label={t('client.groups.delete')} disabled={disabled} onClick={() => remove([group])} />
            </div> },
        ]} />
    </div>
  </div>;
}
