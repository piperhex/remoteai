import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { ThreadContextMenu } from '../ThreadContextMenu';
import { useGrouping } from './context';
import { GroupIcon } from './GroupIcon';

export function GroupHeading({ id, label, icon, collapsed, toggle }: {
  id: string; label: string; icon?: string; collapsed: boolean; toggle: () => void;
}) {
  const groups = useGrouping();
  const t = groups?.translate;
  const title = t?.(collapsed ? 'client.groups.expand' : 'client.groups.collapse', { name: label });
  return <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}
    data-chat-drop-kind="group" data-chat-drop-id={id}>
    <ThreadContextMenu menu={{ items: [{ key: 'manageGroups', label: t?.('client.groups.manage'),
      onClick: () => groups?.openManager() }] }}>
      <button type="button" className="chat-custom-group-heading" aria-expanded={!collapsed}
        aria-label={title} onClick={toggle}>
        <span className="chat-custom-group-toggle-icon" aria-hidden="true">
          <GroupIcon icon={icon} size={14} />
          <ChevronRight size={14} className="chat-custom-group-chevron" />
        </span>
        <span>{label}</span>
      </button>
    </ThreadContextMenu>
    <button type="button" className="chat-custom-group-heading" style={{ width: 'auto' }}
      aria-label={t?.('client.groups.manage')} onClick={() => groups?.openManager()}><MoreHorizontal size={14} /></button>
  </div>;
}
