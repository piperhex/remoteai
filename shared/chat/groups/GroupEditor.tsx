import { useState } from 'react';
import { Button, Input, Modal, Select, Space } from 'antd';
import { groupOptions, GROUP_NAME_LIMIT, type ChatGroup } from './model';
import type { GroupingUI } from './context';
import { GroupIcon } from './GroupIcon';
import { readGroupIcon } from './icon';

export function GroupEditor({ model, group, close }: { model: GroupingUI; group?: ChatGroup; close: () => void }) {
  const t = model.translate;
  const [name, setName] = useState(group?.name ?? '');
  const [parentId, setParent] = useState<string | null>(group?.parentId ?? null);
  const [icon, setIcon] = useState(group?.icon);
  const [uploading, setUploading] = useState(false);
  const save = async () => {
    const fields = { name, parentId, icon };
    if (await model.run(group ? { action: 'edit', id: group.id, ...fields }
      : { action: 'create', group: { id: crypto.randomUUID(), ...fields } })) close();
  };
  return <Modal open width={400} title={t(group ? 'client.groups.edit' : 'client.groups.create')}
    onCancel={close} onOk={() => void save()} confirmLoading={model.busy}
    okText={t('client.projectBrowser.save')} cancelText={t('client.accounts.cancel')}
    okButtonProps={{ disabled: !name.trim() || uploading || !model.ready }}
    closable={!model.busy} maskClosable={!model.busy} cancelButtonProps={{ disabled: model.busy }}>
    <div className="chat-group-editor">
      <label>{t('client.groups.name')}<Input autoFocus value={name} maxLength={GROUP_NAME_LIMIT}
        aria-label={t('client.groups.name')} disabled={model.busy} onChange={event => setName(event.target.value)} /></label>
      <label>{t('client.groups.parent')}<Select value={parentId ?? ''} disabled={model.busy}
        aria-label={t('client.groups.parent')} onChange={value => setParent(value || null)}
        options={[{ value: '', label: t('client.groups.root') }, ...groupOptions(model.grouping.groups, group?.id)]} /></label>
      <Space wrap><GroupIcon icon={icon} size={40} />
        <label className="chat-group-upload">{t('client.groups.upload')}
          <input type="file" accept="image/png,image/jpeg,image/webp" aria-label={t('client.groups.upload')}
            disabled={uploading || model.busy} onChange={async event => {
              const file = event.target.files?.[0]; event.target.value = '';
              if (!file) return;
              setUploading(true);
              try { setIcon(await readGroupIcon(file)); model.setError(''); }
              catch { model.setError('client.groups.iconError'); }
              finally { setUploading(false); }
            }} />
        </label>
        {icon && <Button type="text" disabled={model.busy} onClick={() => setIcon(undefined)}>
          {t('client.groups.resetIcon')}</Button>}
      </Space>
      <small>{t('client.groups.iconHint')}</small>
      {model.error && <p role="alert">{t(model.error as Parameters<typeof t>[0])}</p>}
    </div>
  </Modal>;
}
