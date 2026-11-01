import { useState } from 'react';
import { Dropdown } from 'antd';
import { ChevronLeft, PenLine, Plus, QrCode } from 'lucide-react';
import { t, useLanguage } from '../i18n';

export function TotpMobileHeader({ onBack, onManualAdd, onScanAdd }: {
  onBack: () => void;
  onManualAdd: () => void;
  onScanAdd: () => void;
}) {
  useLanguage();
  const [open, setOpen] = useState(false);
  return <header className="verification-mobile-header">
    <button type="button" className="verification-back" aria-label={t('client.discovery.back')} onClick={onBack}>
      <ChevronLeft size={22} aria-hidden="true" />
    </button>
    <h1>{t('client.app.2faCodes')}</h1>
    <Dropdown trigger={['click']} placement="bottomRight" open={open} onOpenChange={setOpen}
      autoFocus overlayClassName="verification-add-menu" menu={{ items: [
        { key: 'manual', label: t('client.app.addManually'), icon: <PenLine size={20} /> },
        { key: 'scan', label: t('client.app.scanQrCode'), icon: <QrCode size={20} /> },
      ], onClick: ({ key }) => { setOpen(false); if (key === 'scan') onScanAdd(); else onManualAdd(); } }}>
      <button type="button" className="verification-add" aria-label={t('client.shared.add')}
        aria-haspopup="menu" aria-expanded={open}>
        <Plus size={20} aria-hidden="true" /><span>{t('client.shared.add')}</span>
      </button>
    </Dropdown>
  </header>;
}
