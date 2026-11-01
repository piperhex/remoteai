import { useRef, useState } from 'react';
import { Button, Dropdown, Popconfirm } from 'antd';
import { Ellipsis } from 'lucide-react';
import type { MarketText } from './i18n';
import { validPageLink } from './pageLink';
import { publicDraft, type MarketItem, type MarketRequest } from './types';

export function MarketCardActions({ item, busy, t, onEdit, onWrite }: {
  item: MarketItem; busy: boolean; t: MarketText;
  onEdit: (item: MarketItem) => void; onWrite: (request: MarketRequest) => Promise<void>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const changePublication = () => {
    if (!item.published && !validPageLink(item.pageLink)) { onEdit({ ...item, published: true }); return; }
    void onWrite({ type: 'save', id: item.id, revision: item.revision,
      draft: publicDraft(item), published: !item.published });
  };
  return <div className="pm-card-actions" onKeyDownCapture={event => {
    if (event.key !== 'Escape' || (!menuOpen && !confirmDelete)) return;
    event.stopPropagation(); event.preventDefault();
    setMenuOpen(false); setConfirmDelete(false); buttonRef.current?.focus();
  }}>
    <Popconfirm open={confirmDelete} trigger={[]} onOpenChange={setConfirmDelete}
      title={t('market.deleteConfirm')} overlayStyle={{ maxWidth: 400 }}
      okText={t('market.confirmDelete')} cancelText={t('market.cancel')}
      okButtonProps={{ danger: true, loading: busy }} cancelButtonProps={{ disabled: busy }}
      onCancel={() => setConfirmDelete(false)} onConfirm={async () => {
        await onWrite({ type: 'remove', id: item.id, revision: item.revision });
        setConfirmDelete(false);
      }}>
      <Dropdown trigger={['click']} placement="bottomRight" autoFocus disabled={busy}
        open={menuOpen && !busy} onOpenChange={setMenuOpen}
        overlayClassName="pm-card-menu" overlayStyle={{ maxWidth: 400 }} menu={{ items: [
          { key: 'edit', label: t('market.edit'), disabled: busy },
          { key: 'publication', label: t(item.published ? 'market.withdraw' : 'market.republish'), disabled: busy },
          { key: 'remove', label: t('market.remove'), danger: true, disabled: busy },
        ], onClick: ({ key }) => {
          setMenuOpen(false);
          if (busy) return;
          if (key === 'edit') onEdit(item);
          if (key === 'publication') changePublication();
          if (key === 'remove') setConfirmDelete(true);
        } }}>
        <Button ref={buttonRef} type="text" disabled={busy} aria-label={t('market.moreActions')}
          aria-haspopup="menu" aria-expanded={menuOpen && !busy} icon={<Ellipsis size={20} aria-hidden="true" />} />
      </Dropdown>
    </Popconfirm>
  </div>;
}
