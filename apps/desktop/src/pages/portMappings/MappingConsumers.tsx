import { useSyncExternalStore } from 'react';
import { Tooltip } from 'antd';
import { Monitor } from 'lucide-react';
import { uiText as t } from '../../../../../shared/localization/uiText';
import { mappingOrigin } from '../../../../../shared/port-mapping/target';
import type { PortMapping } from '../../../../../shared/port-mapping/settings';
import { mappingConsumers } from '../../remoteChat/mappingConsumers';
import styles from './page.module.less';

export function MappingConsumers({ entry }: { entry: PortMapping }) {
  const origin = new URL(mappingOrigin(entry)).origin;
  const devices = useSyncExternalStore(mappingConsumers.subscribe, () => mappingConsumers.devices(entry.id, origin));
  const text = t('client.mappingHub.consumerCount', { count: devices.size });
  const names = [...devices].sort((left, right) => left[1].localeCompare(right[1]));
  return <Tooltip trigger={['hover', 'focus', 'click']} styles={{ root: { maxWidth: 'min(400px, 90vw)' } }}
    title={names.length ? <ul className={styles.consumerList}>
      {names.map(([id, name]) => <li key={id}>{name}</li>)}</ul> : t('client.mappingHub.noConsumers')}>
    <button type="button" className={styles.consumers}><Monitor aria-hidden size={13} />{text}</button>
  </Tooltip>;
}
