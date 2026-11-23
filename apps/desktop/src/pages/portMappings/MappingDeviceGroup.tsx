import { useSyncExternalStore } from 'react';
import { ArrowRight, Cloud, CloudUpload, Monitor } from 'lucide-react';
import { displayError, guiLocale, uiText as t } from '../../../../../shared/localization/uiText';
import { mappingAddress } from '../../../../../shared/port-mapping/target';
import { protocolLabel } from '../../../../../shared/port-mapping/settings';
import { ForwardedAddress } from '../codexGui/portForwarding/ForwardedAddress';
import { MappingActions } from '../codexGui/portForwarding/MappingActions';
import { MappingStatus } from '../codexGui/portForwarding/MappingRow';
import type { ForwardingEntry } from '../codexGui/portForwarding/service';
import type { MappingGroup } from './useMappingGroups';
import styles from './page.module.less';

export interface MappingSelection { deviceId: string; entryId: string; mode: 'edit' | 'rename' }
type SelectMapping = (selection: MappingSelection) => void;

export function MappingDeviceGroup({ group, select }: { group: MappingGroup; select: SelectMapping }) {
  const { device, session, entries } = group;
  const sync = useSyncExternalStore(session.sync.subscribe, session.sync.snapshot);
  const SyncIcon = session.sync.isSynced() ? Cloud : CloudUpload;
  return <section className={styles.group} aria-label={device.name}>
    <header className={styles.groupHeader}>
      <span className={styles.deviceIcon}><Monitor size={19} /></span>
      <h3>{device.name}</h3>
      <span className={styles.presence} data-online={device.online}>{t(device.online ? 'client.chat.online' : 'client.chat.offline')}</span>
      {sync && <span className={styles.sync} role="status"><SyncIcon size={15} />{displayError(sync)}</span>}
    </header>
    <div className={styles.columns} aria-hidden="true">
      <span>{t('client.portMappingEditing.localAccess')}</span>
      <span>{t('client.portMappingEditing.remoteTarget')}</span>
      <span>{t('client.groups.actions')}</span>
    </div>
    {[...entries].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).map(entry =>
      <DeviceRow key={entry.id} entry={entry} group={group} select={select} />)}
  </section>;
}

function DeviceRow({ entry, group, select }: { entry: ForwardingEntry; group: MappingGroup; select: SelectMapping }) {
  const { device, session } = group;
  const alias = useSyncExternalStore(session.aliases.subscribe, () => session.aliases.get(entry.id));
  const target = mappingAddress(entry);
  const local = `127.0.0.1:${entry.localPort}`;
  const open = (mode: MappingSelection['mode']) => select({ mode, deviceId: device.deviceId, entryId: entry.id });
  return <article className={styles.row} aria-label={`${local} → ${target}`}>
    <div className={styles.local}>
      {alias && <strong className={styles.alias}>{alias}</strong>}
      {entry.protocol === 'udp' ? <code>{local}</code>
        : <ForwardedAddress port={entry.localPort} running={entry.status === 'running'} />}
      <div className={styles.meta}><span className={styles.protocol}>{protocolLabel(entry.protocol)}</span>
        <MappingStatus entry={entry} /></div>
    </div>
    <div className={styles.target}><ArrowRight size={15} aria-hidden="true" /><code>{target}</code>
      {entry.updatedAt && <small>{t('client.portMappingEditing.lastEdited.4f04ab')} · {new Date(entry.updatedAt)
        .toLocaleDateString(guiLocale(), { month: 'short', day: 'numeric' })}</small>}</div>
    <div className={styles.actions}><MappingActions entry={entry} service={session.service} connected={device.online}
      edit={() => open('edit')} rename={() => open('rename')} /></div>
    {entry.error && <p className={styles.error} role="alert">{displayError(entry.error)}</p>}
  </article>;
}
