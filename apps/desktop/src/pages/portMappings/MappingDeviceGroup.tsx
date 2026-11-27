import { useId, useState, useSyncExternalStore } from 'react';
import { computerDetails } from '../../../../../shared/remote-chat/devices';
import { ChevronDown, Cloud, CloudUpload, Monitor } from 'lucide-react';
import { displayError, uiText as t } from '../../../../../shared/localization/uiText';
import { localMappingAddress, mappingAddress } from '../../../../../shared/port-mapping/target';
import { protocolLabel } from '../../../../../shared/port-mapping/settings';
import { ForwardedAddress } from '../codexGui/portForwarding/ForwardedAddress';
import { MappingActions } from '../codexGui/portForwarding/MappingActions';
import { MappingName } from '../codexGui/portForwarding/MappingName';
import { MappingStatus } from '../codexGui/portForwarding/MappingRow';
import type { ForwardingEntry } from '../codexGui/portForwarding/service';
import type { MappingGroup } from './useMappingGroups';
import { MappingConsumers } from './MappingConsumers';
import styles from './page.module.less';

export interface MappingSelection { deviceId: string; entryId: string; mode: 'edit' }
type SelectMapping = (selection: MappingSelection) => void;

export function MappingDeviceGroup({ group, select }: { group: MappingGroup; select: SelectMapping }) {
  const { device, session, entries } = group;
  const [expanded, setExpanded] = useState(true);
  const cardsId = useId();
  const sync = useSyncExternalStore(session.sync.subscribe, session.sync.snapshot);
  const SyncIcon = session.sync.isSynced() ? Cloud : CloudUpload;
  return <section className={styles.group} aria-label={device.name}>
    <h3 className={styles.groupTitle}><button type="button" className={styles.groupHeader}
      aria-label={device.name} aria-expanded={expanded} aria-controls={cardsId} onClick={() => setExpanded(!expanded)}>
      <span className={styles.deviceIcon}><Monitor size={19} /></span>
      <span className={styles.groupIdentity}><strong>{device.name}</strong><small>{computerDetails(device)}</small></span>
      <span className={styles.presence} data-online={device.online}>{session.local ? t('client.app.currentComputer')
        : t(device.online ? 'client.chat.online' : 'client.chat.offline')}</span>
      {sync && <span className={styles.sync} role="status"><SyncIcon size={15} />{displayError(sync)}</span>}
      <ChevronDown className={styles.chevron} size={17} aria-hidden="true" />
    </button></h3>
    <div id={cardsId} className={styles.cards} hidden={!expanded}>
      {!entries.length && <small className={styles.emptyDevice}>{t('client.portForwarding.noPortMappingsYet')}</small>}
      {[...entries].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).map(entry =>
        <MappingCard key={entry.id} entry={entry} group={group} select={select} />)}
    </div>
  </section>;
}

function MappingCard({ entry, group, select }: { entry: ForwardingEntry; group: MappingGroup; select: SelectMapping }) {
  const { device, session } = group;
  const target = mappingAddress(entry);
  const local = localMappingAddress(entry);
  const edit = () => select({ mode: 'edit', deviceId: device.deviceId, entryId: entry.id });
  return <article className={styles.card} aria-label={`${local} → ${target}`}>
    <header className={styles.cardHeader}>
      <MappingName entry={entry} aliases={session.aliases} />
      <div className={styles.meta}><span className={styles.protocol}>{protocolLabel(entry.protocol)}</span>
        {session.local ? <MappingConsumers entry={entry} /> : <MappingStatus entry={entry} />}</div>
    </header>
    <dl className={styles.endpoints}>
      <dt>{t('client.portMappingEditing.localAccess')}</dt>
      <dd>{entry.protocol === 'udp' ? <code>{local}</code> : <ForwardedAddress entry={entry} local={session.local} />}</dd>
      <dt>{t('client.portMappingEditing.remoteTarget')}</dt><dd><code>{target}</code></dd>
    </dl>
    <footer className={styles.cardFooter}>
      <MappingActions entry={entry} service={session.service} connected={device.online} local={session.local}
        edit={edit} />
    </footer>
    {entry.error && <p className={styles.error} role="alert">{displayError(entry.error)}</p>}
  </article>;
}
