import { useSyncExternalStore } from 'react';
import { uiText as t } from '../../../../../../shared/localization/uiText';
import type { LocalMappingAliases } from '../../../../../../shared/port-mapping/localAliases';
import type { ForwardingEntry } from './service';
import styles from './portForwarding.module.less';

export function MappingName({ entry, aliases }: {
  entry: ForwardingEntry; aliases: LocalMappingAliases;
}) {
  const alias = useSyncExternalStore(aliases.subscribe, () => aliases.get(entry.id));
  return <strong className={styles.mappingName}>{alias || t('client.settings.untitled')}</strong>;
}
