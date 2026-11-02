import type { ReactNode } from 'react';
import { Drawer } from 'antd';
import { HardDrive, Server } from 'lucide-react';
import { displayText as t } from '../localization/messages';

export function MobileLoungeSheet({ title, close, children, className = '', actions = false }: {
  title: ReactNode; close: () => void; children: ReactNode; className?: string; actions?: boolean;
}) {
  return <Drawer open placement="bottom" height="auto" title={title} onClose={close}
    closeIcon={actions ? <span className="lounge-action-sheet-handle" aria-hidden /> : undefined}
    closable={actions ? { 'aria-label': t('client.lounge.cancel') } : true}
    rootClassName={`lounge-mobile-sheet ${actions ? 'lounge-composer-sheet' : ''} ${className}`}
    styles={{ body: { maxHeight: '70dvh', overflow: 'auto' } }}>
    {children}
  </Drawer>;
}

export function LoungeAbout({ direct, close }: { direct: boolean; close: () => void }) {
  return <MobileLoungeSheet title={t('client.lounge.about')} close={close}>
    <div className="lounge-info-row"><HardDrive size={21} /><div>
      <h3>{t('client.lounge.localTitle')}</h3><p>{t('client.lounge.localHint')}</p></div></div>
    <div className="lounge-info-row"><Server size={21} /><div>
      <h3>{t('client.lounge.serverTitle')}</h3>
      <p>{t(direct ? 'client.lounge.directOfflineHint' : 'client.lounge.groupOfflineHint')}</p></div></div>
    <button className="lounge-sheet-done" type="button" onClick={close}>{t('client.lounge.done')}</button>
  </MobileLoungeSheet>;
}
