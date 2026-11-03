import { useState, type CSSProperties } from 'react';
import { Alert, Button, Modal, Tabs, theme } from 'antd';
import type { GroupingUI } from './context';
import type { ChatGroup } from './model';
import { GroupEditor } from './GroupEditor';
import { GroupMembers } from './GroupMembers';
import { GroupCards } from './GroupCards';
import { GroupTable } from './GroupTable';
import { GroupDeleteDialog } from './GroupDeleteDialog';
import './groupManager.css';

export function GroupManager({ model, mobile }: { model: GroupingUI; mobile: boolean }) {
  const t = model.translate;
  const { token } = theme.useToken();
  const [editing, setEditing] = useState<ChatGroup | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ChatGroup[] | null>(null);
  const colors = {
    '--group-primary': token.colorPrimary,
    '--group-selected': token.colorPrimaryBg,
    '--group-hover': token.colorPrimaryBgHover,
    '--group-border': token.colorBorderSecondary,
    '--group-header': token.colorFillAlter,
    '--group-surface': token.colorBgContainer,
    '--group-muted': token.colorTextSecondary,
    '--group-danger-bg': token.colorErrorBg,
    '--group-danger': token.colorError,
  } as CSSProperties;
  return <Modal open centered={!mobile} width={mobile ? 880 : '85vw'} footer={null}
    title={t('client.groups.manage')} onCancel={() => { if (!model.busy) model.closeManager(); }}
    className={`chat-group-manager${mobile ? '' : ' chat-group-manager-desktop'}`} style={colors}
    styles={mobile ? { body: { maxHeight: '75vh', overflowY: 'auto' } } : undefined}>
    {model.error && !editing && !deleting && <Alert type="error" showIcon style={{ maxWidth: 400 }}
      message={t(model.error as Parameters<typeof t>[0])} />}
    <Tabs items={[
      { key: 'groups', label: t('client.groups.groups'), children: mobile ? <>
        <Button type="primary" disabled={model.busy || !model.ready}
          onClick={() => setEditing('new')}>{t('client.groups.create')}</Button>
        <GroupCards model={model} edit={setEditing} remove={group => setDeleting([group])} />
      </> : <GroupTable model={model} edit={setEditing} remove={setDeleting} /> },
      { key: 'members', label: t('client.groups.members'), children: <GroupMembers model={model} mobile={mobile} /> },
    ]} />
    {editing && <GroupEditor model={model} group={editing === 'new' ? undefined : editing}
      close={() => { setEditing(null); model.setError(''); }} />}
    {deleting && <GroupDeleteDialog model={model} groups={deleting}
      close={() => { setDeleting(null); model.setError(''); }} />}
  </Modal>;
}
