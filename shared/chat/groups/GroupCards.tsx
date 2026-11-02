import { Button, Card, Dropdown } from 'antd';
import { MoreHorizontal } from 'lucide-react';
import type { GroupingUI } from './context';
import { groupPath, type ChatGroup } from './model';
import { GroupIcon } from './GroupIcon';

export function GroupCards({ model, edit, remove }: {
  model: GroupingUI; edit: (group: ChatGroup) => void; remove: (group: ChatGroup) => void;
}) {
  const t = model.translate;
  return <div className="chat-group-cards">
    {!model.grouping.groups.length && <p>{t('client.groups.empty')}</p>}
    {model.grouping.groups.map(group => <Card key={group.id} size="small" className="chat-group-card">
      <div className="chat-group-card-heading"><GroupIcon icon={group.icon} size={22} />
        <strong>{group.name}</strong>
        <Dropdown trigger={['click']} overlayStyle={{ maxWidth: 400 }} menu={{ items: [
          { key: 'edit', label: t('client.groups.edit'), onClick: () => edit(group) },
          { key: 'delete', label: t('client.groups.delete'), danger: true, onClick: () => remove(group) },
        ] }} disabled={model.busy || !model.ready}>
          <Button type="text" className="chat-group-card-more" icon={<MoreHorizontal size={18} />}
            disabled={model.busy || !model.ready} aria-haspopup="menu"
            aria-label={t('client.app.moreActionsFor', { value1: group.name })} />
        </Dropdown>
      </div>
      <div className="chat-group-card-detail"><span>{t('client.groups.parent')}</span>
        <span>{group.parentId ? groupPath(model.grouping.groups, group.parentId) : t('client.groups.root')}</span></div>
    </Card>)}
  </div>;
}
