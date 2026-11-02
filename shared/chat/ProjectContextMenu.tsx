import type { ReactElement } from 'react';
import { Dropdown, type MenuProps } from 'antd';
import { FolderOpen, MoreHorizontal, Pin, PinOff, X } from 'lucide-react';
import type { MessageTranslator } from '../localization/messages';
import { ThreadContextMenu } from './ThreadContextMenu';
import styles from './ThreadContextMenu.module.less';
import { useGroupMenu } from './groups/useGroupMenu';

export function ProjectContextMenu({ label, pinned, removing, pinDisabled, openDisabled, removeDisabled,
  onPin, onOpen, onRemove, translate, buttonClassName, showActionButton = true, groupPath, children }: {
  label: string; pinned: boolean; removing?: boolean; pinDisabled?: boolean; openDisabled?: boolean;
  removeDisabled: boolean;
  onPin: () => void; onOpen?: () => void; onRemove: () => void; translate: MessageTranslator;
  buttonClassName: string; showActionButton?: boolean; children: ReactElement; groupPath?: string;
}) {
  const groupItems = useGroupMenu(groupPath ? { kind: 'project', id: groupPath } : undefined);
  const menu: MenuProps = { items: [
    { key: 'pin', label: translate(pinned ? 'client.conversation.unpin' : 'client.conversation.pin'),
      icon: pinned ? <PinOff size={16} /> : <Pin size={16} />, disabled: pinDisabled },
    ...(onOpen ? [{ key: 'openProject', label: translate('client.projectBrowser.openInExplorer'),
      icon: <FolderOpen size={16} />, disabled: openDisabled }] : []),
    ...groupItems,
    { type: 'divider' },
    { key: 'remove', label: translate(removing ? 'client.conversation.removing' : 'client.conversation.removeProject'),
      icon: <X size={16} />, disabled: removeDisabled },
  ], onClick: ({ key }) => {
    if (key === 'pin') onPin();
    if (key === 'openProject') onOpen?.();
    if (key === 'remove') onRemove();
  } };
  return <>
    <ThreadContextMenu menu={menu}>{children}</ThreadContextMenu>
    {showActionButton && <Dropdown trigger={['click']} overlayStyle={{ maxWidth: 400 }}
      overlayClassName={styles.menu} menu={menu}>
      <button type="button" className={buttonClassName} aria-haspopup="menu"
        aria-label={translate('client.conversation.manageProject', { value1: label })}>
        <MoreHorizontal size={14} aria-hidden="true" />
      </button>
    </Dropdown>}
  </>;
}
