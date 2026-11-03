import { Alert, Modal } from 'antd';
import type { GroupingUI } from './context';
import type { ChatGroup } from './model';
import { planGroupDeletion } from './managerRows';

export function GroupDeleteDialog({ model, groups, close }: {
  model: GroupingUI; groups: ChatGroup[]; close: () => void;
}) {
  const t = model.translate;
  const remove = async () => {
    const success = await model.perform(async () => {
      const ids = planGroupDeletion(model.grouping, groups);
      // The existing host protocol applies each mutation to its latest state. Stop on failure;
      // the dialog and selection retain any groups that still need to be removed.
      for (const id of ids) await model.client.mutate({ action: 'delete', id });
    });
    if (success) close();
  };
  return <Modal open width={400} title={groups.length === 1
    ? t('client.groups.deleteTitle', { name: groups[0].name })
    : t('client.groups.batchDeleteTitle', { count: groups.length })}
    okText={t(groups.length === 1 ? 'client.groups.delete' : 'client.groups.batchDelete')}
    cancelText={t('client.accounts.cancel')} confirmLoading={model.busy}
    okButtonProps={{ danger: true, disabled: !model.ready }} cancelButtonProps={{ disabled: model.busy }}
    closable={!model.busy} maskClosable={!model.busy} keyboard={!model.busy} onCancel={close}
    onOk={() => void remove()}>
    <p>{t('client.groups.deleteHint')}</p>
    {model.error && <Alert type="error" showIcon message={t(model.error as Parameters<typeof t>[0])} />}
  </Modal>;
}
