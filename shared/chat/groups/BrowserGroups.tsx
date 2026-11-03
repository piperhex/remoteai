import { useState, type ReactNode } from 'react';
import { Alert, Button, Modal, Space, Table, Tabs } from 'antd';
import { CircleMinus } from 'lucide-react';
import { GroupingContext, useGroupingUI, type GroupingUI } from './context';
import { groupOptions, groupPath, type ChatGroup } from './model';
import { GroupIcon } from './GroupIcon';
import { GroupEditor } from './GroupEditor';
import { GroupMembers } from './GroupMembers';
import { GroupCards } from './GroupCards';
import './groups.css';
import { SidebarDrag, type SidebarDragOptions } from './SidebarDrag';

export function BrowserGroups({ children, mobile = false, drag, ...options }: Parameters<typeof useGroupingUI>[0]
  & { children: ReactNode; mobile?: boolean; drag?: SidebarDragOptions }) {
  const model = useGroupingUI(options);
  return <GroupingContext.Provider value={model}><SidebarDrag options={mobile ? undefined : drag}>
    {children}</SidebarDrag>
    {model.managerOpen && <GroupManager model={model} mobile={mobile} />}
    {model.moveTarget && <Modal open width={400} footer={null} title={model.translate('client.groups.move')}
      onCancel={() => { if (!model.busy) model.setMoveTarget(null); }}>
      <div className="chat-group-picker">
        {groupOptions(model.grouping.groups).map(group => <Button key={group.value} disabled={model.busy || !model.ready}
          icon={<GroupIcon icon={group.icon} />} onClick={() => void model.assign([model.moveTarget!], group.value)}>
          {group.label}</Button>)}
        <Button danger icon={<CircleMinus size={16} />} disabled={model.busy || !model.ready}
          onClick={() => void model.assign([model.moveTarget!], null)}>
          {model.translate('client.groups.remove')}</Button>
        <Button onClick={model.openManager}>{model.translate('client.groups.manage')}</Button>
      </div>
    </Modal>}
    {model.error && !model.managerOpen && <Modal open width={400} footer={null}
      title={model.translate('client.groups.manage')} onCancel={() => model.setError('')}>
      <p role="alert">{model.translate(model.error as Parameters<typeof model.translate>[0])}</p>
    </Modal>}
  </GroupingContext.Provider>;
}

function GroupManager({ model, mobile }: { model: GroupingUI; mobile: boolean }) {
  const t = model.translate;
  const [editing, setEditing] = useState<ChatGroup | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ChatGroup | null>(null);
  return <Modal open width={880} footer={null} title={t('client.groups.manage')}
    onCancel={() => { if (!model.busy) model.closeManager(); }}
    className="chat-group-manager" styles={{ body: { maxHeight: '75vh', overflowY: 'auto' } }}>
    {model.error && !editing && <Alert type="error" showIcon style={{ maxWidth: 400 }}
      message={t(model.error as Parameters<typeof t>[0])} />}
    <Tabs items={[
      { key: 'groups', label: t('client.groups.groups'), children: <>
        <Button type="primary" disabled={model.busy || !model.ready}
          onClick={() => setEditing('new')}>{t('client.groups.create')}</Button>
        {mobile ? <GroupCards model={model} edit={setEditing} remove={setDeleting} />
          : <Table<ChatGroup> size="small" rowKey="id" dataSource={model.grouping.groups}
          locale={{ emptyText: t('client.groups.empty') }} pagination={false} columns={[
            { title: t('client.groups.name'), render: (_, group) => <Space><GroupIcon icon={group.icon} />
              <span>{group.name}</span></Space> },
            { title: t('client.groups.parent'), render: (_, group) => group.parentId
              ? groupPath(model.grouping.groups, group.parentId) : t('client.groups.root') },
            { key: 'actions', render: (_, group) => <Space wrap>
              <Button size="small" disabled={model.busy || !model.ready}
                onClick={() => setEditing(group)}>{t('client.groups.edit')}</Button>
              <Button size="small" danger disabled={model.busy || !model.ready}
                onClick={() => setDeleting(group)}>{t('client.groups.delete')}</Button>
            </Space> },
          ]} />}
      </> },
      { key: 'members', label: t('client.groups.members'), children: <GroupMembers model={model} mobile={mobile} /> },
    ]} />
    {editing && <GroupEditor model={model} group={editing === 'new' ? undefined : editing}
      close={() => { setEditing(null); model.setError(''); }} />}
    {deleting && <Modal open width={400} title={t('client.groups.deleteTitle', { name: deleting.name })}
      okText={t('client.groups.delete')} cancelText={t('client.accounts.cancel')}
      confirmLoading={model.busy} okButtonProps={{ danger: true }} onCancel={() => setDeleting(null)}
      onOk={async () => { if (await model.run({ action: 'delete', id: deleting.id })) setDeleting(null); }}>
      <p>{t('client.groups.deleteHint')}</p>
    </Modal>}
  </Modal>;
}
