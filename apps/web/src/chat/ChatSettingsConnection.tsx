import { ChevronRight, Monitor, User } from 'lucide-react';
import { t } from '../i18n';

interface Props {
  deviceName: string;
  accountName: string;
  onDevice: () => void;
  onAccount: () => void;
}

export function ChatSettingsConnection({ deviceName, accountName, onDevice, onAccount }: Props) {
  return <div className="chat-settings-connection">
    <button type="button" onClick={onDevice} aria-label={t('client.chat.switchComputer')}>
      <Monitor size={22} /><strong>{t('client.chatSettings.computer')}</strong>
      <span>{deviceName}</span><ChevronRight size={20} />
    </button>
    <button type="button" onClick={onAccount} aria-label={t('client.chat.switchAccount')}>
      <User size={22} /><strong>{t('client.chatSettings.account')}</strong>
      <span>{accountName}</span><ChevronRight size={20} />
    </button>
  </div>;
}
