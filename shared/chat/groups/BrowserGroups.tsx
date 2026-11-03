import type { ReactNode } from 'react';
import { Button, Modal } from 'antd';
import { CircleMinus } from 'lucide-react';
import { GroupingContext, useGroupingUI } from './context';
import { groupOptions } from './model';
import { GroupIcon } from './GroupIcon';
import { GroupManager } from './GroupManager';
import './groups.css';
import { SidebarDrag, type SidebarDragOptions } from './SidebarDrag';

export function BrowserGroups({ children, mobile = false, drag, ...options }: Parameters<typeof useGroupingUI>[0]
  & { children: ReactNode; mobile?: boolean; drag?: SidebarDragOptions }) {
  const model = useGroupingUI(options);
  return <GroupingContext.Provider value={model}><SidebarDrag options={mobile ? undefined : drag}>
    {children}</SidebarDrag>
    {model.managerOpen && <GroupManager model={model} mobile={mobile} />}
    {model.moveTarget && <Modal open width={400} footer={null} title={model.translate('client.groups.move')}
      onCancel={() => { if (!model.busy) model.setMoveTarget(null); }}>
      <div className="chat-group-picker">
        {groupOptions(model.grouping.groups).map(group => <Button key={group.value} disabled={model.busy || !model.ready}
          icon={<GroupIcon icon={group.icon} />} onClick={() => void model.assign([model.moveTarget!], group.value)}>
          {group.label}</Button>)}
        <Button danger icon={<CircleMinus size={16} />} disabled={model.busy || !model.ready}
          onClick={() => void model.assign([model.moveTarget!], null)}>
          {model.translate('client.groups.remove')}</Button>
        <Button onClick={model.openManager}>{model.translate('client.groups.manage')}</Button>
      </div>
    </Modal>}
    {model.error && !model.managerOpen && <Modal open width={400} footer={null}
      title={model.translate('client.groups.manage')} onCancel={() => model.setError('')}>
      <p role="alert">{model.translate(model.error as Parameters<typeof model.translate>[0])}</p>
    </Modal>}
  </GroupingContext.Provider>;
}
