import { useState } from 'react';
import { Dropdown } from 'antd';
import { ChevronLeft, Plus, QrCode, SquarePen } from 'lucide-react';
import { t, useLanguage } from '../i18n';

// Match the native header's 6px bottom padding plus the menu's 6px gap.
const MENU_OFFSET = 12;

export function TotpMobileHeader({ onBack, onManualAdd, onScanAdd }: {
  onBack: () => void;
  onManualAdd: () => void;
  onScanAdd: () => void;
}) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [focusMenu, setFocusMenu] = useState(false);
  return <header className="verification-mobile-header">
    <button type="button" className="verification-back" aria-label={t('client.discovery.back')} onClick={onBack}>
      <ChevronLeft size={22} aria-hidden="true" />
    </button>
    <h1>{t('client.app.2faCodes')}</h1>
    <Dropdown trigger={['click']} placement="bottomRight" align={{ offset: [0, MENU_OFFSET] }}
      open={open} onOpenChange={setOpen} autoFocus={focusMenu}
      overlayClassName="verification-add-menu" menu={{ items: [
        { key: 'manual', label: t('client.app.addManually'), icon: <SquarePen size={20} strokeWidth={1.5} /> },
        { key: 'scan', label: t('client.app.scanQrCode'), icon: <QrCode size={20} strokeWidth={1.5} /> },
      ], onClick: ({ key }) => { setOpen(false); if (key === 'scan') onScanAdd(); else onManualAdd(); } }}>
      <button type="button" className="verification-add" aria-label={t('client.shared.add')}
        aria-haspopup="menu" aria-expanded={open} onClick={event => setFocusMenu(event.detail === 0)}>
        <Plus size={20} strokeWidth={1.5} aria-hidden="true" /><span>{t('client.shared.add')}</span>
      </button>
    </Dropdown>
  </header>;
}
