import { useRef, useState, useSyncExternalStore } from 'react';
import { Button, Modal, Typography } from 'antd';
import { KeyRound } from 'lucide-react';
import { uiText } from '../../../../shared/localization/uiText';
import { invoke } from '../api/backend';
import {
  clearKeyringIssue, getKeyringIssue, reportKeyringIssue, subscribeKeyring, type KeyringIssue,
} from './keyringState';

const installCommands: Partial<Record<KeyringIssue, string>> = {
  KEYRING_SERVICE_DEBIAN: 'sudo apt install gnome-keyring',
  KEYRING_SERVICE_FEDORA: 'sudo dnf install gnome-keyring',
  KEYRING_SERVICE_ARCH: 'sudo pacman -S gnome-keyring',
};

function promptCopy(issue: KeyringIssue) {
  switch (issue) {
    case 'KEYRING_CREATE':
      return { action: uiText('client.keyring.create'), detail: uiText('client.keyring.createDetail') };
    case 'KEYRING_LOCKED':
      return { action: uiText('client.keyring.unlock'), detail: uiText('client.keyring.unlockDetail') };
    default:
      return { action: uiText('client.keyring.retry'),
        detail: uiText(issue === 'KEYRING_ACCESS' ? 'client.keyring.access' : 'client.keyring.service') };
  }
}

export function KeyringSetup() {
  const issue = useSyncExternalStore(subscribeKeyring, getKeyringIssue);
  return issue ? <KeyringPrompt issue={issue} /> : null;
}

function KeyringPrompt({ issue }: { issue: KeyringIssue }) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const { action, detail } = promptCopy(issue);
  const prepare = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await invoke('prepare_chat_keyring');
      clearKeyringIssue();
    } catch (error) {
      if (!reportKeyringIssue(error)) reportKeyringIssue('KEYRING_ACCESS');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return <>
    <Button size="small" icon={<KeyRound size={14} />} onClick={() => setOpen(true)}>{uiText('client.keyring.title')}</Button>
    <Modal open={open} title={uiText('client.keyring.title')} width={400} onCancel={() => setOpen(false)}
      footer={<Button type="primary" loading={busy} onClick={() => void prepare()}>{action}</Button>}>
      <Typography.Paragraph>{detail}</Typography.Paragraph>
      {installCommands[issue] && <Typography.Text code copyable>{installCommands[issue]}</Typography.Text>}
    </Modal>
  </>;
}
