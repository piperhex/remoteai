import type { MenuProps } from 'antd';
import { CircleMinus, Settings2 } from 'lucide-react';
import { useGrouping } from './context';
import { groupOptions, type GroupTarget } from './model';
import { GroupIcon } from './GroupIcon';

export function useGroupMenu(target?: GroupTarget): NonNullable<MenuProps['items']> {
  const groups = useGrouping();
  if (!groups || !target) return [];
  const t = groups.translate;
  const move = (groupId: string | null) => { void groups.assign([target], groupId); };
  return [{ key: 'moveToGroup', label: t('client.groups.move'), icon: <GroupIcon />,
    disabled: !groups.ready || groups.busy,
    popupClassName: 'chat-custom-group-menu', children: [
      ...groupOptions(groups.grouping.groups).map(group => ({ key: `moveGroup:${group.value}`,
        label: group.label, icon: <GroupIcon icon={group.icon} />, onClick: () => move(group.value) })),
      { key: 'moveGroup:root', label: t('client.groups.remove'), icon: <CircleMinus size={16} />,
        danger: true, onClick: () => move(null) },
      { type: 'divider' },
      { key: 'manageGroups', label: t('client.groups.manage'), icon: <Settings2 size={16} />,
        onClick: groups.openManager },
    ] }];
}
