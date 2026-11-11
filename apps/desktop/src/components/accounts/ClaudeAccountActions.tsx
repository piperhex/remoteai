import { uiText } from '../../../../../shared/localization/uiText';
import { useState } from 'react';
import { Button, Dropdown, Modal, Space } from 'antd';
import { MoreHorizontal } from 'lucide-react';
import type { Account } from '../../types';
import type { Translate } from '../../i18n';
import { ClaudeAccountModal } from '../../../../../shared/accounts/ClaudeAccountModal';
import { localClaudeAccounts } from '../../../../../shared/accounts/claudeAccounts';

export function ClaudeAccountActions({ account, busy, onSwitch, onDeactivate, onRefresh, onDelete, t }: {
  account: Account; busy: boolean; onSwitch: (id: string) => void; onDeactivate: (id: string) => void;
  onRefresh: (id: string) => void; onDelete: (id: string) => void; t: Translate;
}) {
  const [reauthorize, setReauthorize] = useState(false);
  const [removing, setRemoving] = useState(false);
  return <Space size={4}>
    <Button size="small" type={account.active ? 'default' : 'primary'} disabled={account.active}
      loading={busy} onClick={() => onSwitch(account.id)}>
      {account.active ? uiText('client.officialAccounts.current') : t('table.switch')}</Button>
    <Dropdown trigger={['click']} menu={{ items: [
      { key: 'refresh', label: uiText('client.officialAccounts.refresh'), onClick: () => onRefresh(account.id) },
      { key: 'reauthorize', label: uiText('client.officialAccounts.reauthorize'), onClick: () => setReauthorize(true) },
      ...(account.active ? [{ key: 'deactivate', label: uiText('client.officialAccounts.deactivate'),
        onClick: () => onDeactivate(account.id) }] : []),
      { key: 'delete', danger: true, disabled: account.active, label: uiText('client.officialAccounts.remove'),
        onClick: () => setRemoving(true) },
    ] }}>
      <Button size="small" disabled={busy} icon={<MoreHorizontal size={16} />} aria-label={t('table.moreActions')} />
    </Dropdown>
    {reauthorize && <ClaudeAccountModal transport={localClaudeAccounts} accountId={account.id}
      onClose={() => setReauthorize(false)} onSaved={() => { setReauthorize(false); onRefresh(account.id); }} />}
    <Modal open={removing} width={400} title={uiText('client.officialAccounts.remove')}
      okText={t('table.delete')} cancelText={t('table.cancel')} okButtonProps={{ danger: true }}
      onCancel={() => setRemoving(false)} onOk={() => { setRemoving(false); onDelete(account.id); }}>
      {uiText('client.officialAccounts.removeHint')}</Modal>
  </Space>;
}
