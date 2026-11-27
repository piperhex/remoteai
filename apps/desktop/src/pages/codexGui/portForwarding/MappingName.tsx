import { useSyncExternalStore } from 'react';
import { Button, Tooltip } from 'antd';
import { Pencil } from 'lucide-react';
import { uiText as t } from '../../../../../../shared/localization/uiText';
import type { LocalMappingAliases } from '../../../../../../shared/port-mapping/localAliases';
import { localMappingAddress, mappingAddress } from '../../../../../../shared/port-mapping/target';
import type { ForwardingEntry } from './service';
import styles from './portForwarding.module.less';

export function MappingName({ entry, aliases, edit }: {
  entry: ForwardingEntry; aliases: LocalMappingAliases; edit: () => void;
}) {
  const alias = useSyncExternalStore(aliases.subscribe, () => aliases.get(entry.id));
  const title = t('client.portMappingEditing.editMapping');
  return <div className={styles.mappingName}>
    <strong>{alias || t('client.settings.untitled')}</strong>
    <Tooltip title={title} styles={{ root: { maxWidth: 400 } }}>
      <Button type="text" size="small" aria-label={`${title} ${localMappingAddress(entry)} → ${mappingAddress(entry)}`}
        icon={<Pencil size={14} />} disabled={entry.status === 'starting' || entry.status === 'stopping'}
        onClick={edit} />
    </Tooltip>
  </div>;
}
