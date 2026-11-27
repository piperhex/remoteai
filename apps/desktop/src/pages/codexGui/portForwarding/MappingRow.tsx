import { displayText, displayError } from '../../../../../../shared/localization/uiText';
import { MappingActions } from './MappingActions';
import { MappingName } from './MappingName';
import type { LocalMappingAliases } from '../../../../../../shared/port-mapping/localAliases';
import { ArrowRight } from 'lucide-react';
import { ForwardedAddress } from './ForwardedAddress';
import { protocolLabel } from '../../../../../../shared/port-mapping/settings';
import { localMappingAddress, mappingAddress } from '../../../../../../shared/port-mapping/target';
import type { ForwardingEntry, PortForwardingService } from './service';
import styles from './portForwarding.module.less';

const STATUS_TEXT = { stopped: "client.chat.stopped", starting: "client.portForwarding.starting", running: "client.portForwarding.active",
  stopping: "client.portForwarding.stopping", error: "client.portForwarding.couldNotStart" } as const;

export function MappingStatus({ entry }: { entry: ForwardingEntry }) {
  return <span className={styles.status} data-state={entry.status} role="status">
    {displayText(STATUS_TEXT[entry.status])}
  </span>;
}

export function MappingRow({ entry, service, aliases, connected, onOpen, edit }: {
  aliases: LocalMappingAliases;
  entry: ForwardingEntry; service: PortForwardingService; connected: boolean; onOpen: () => void; edit: () => void;
}) {
  const target = mappingAddress(entry);
  const address = localMappingAddress(entry);
  const label = `${address} → ${target}`;
  return <article className={styles.mapping} aria-label={label}>
    <header className={styles.mappingHeader}>
      <MappingName entry={entry} aliases={aliases} />
      <div className={styles.metadata}>
        <span className={styles.protocol}>{protocolLabel(entry.protocol)}</span>
        <MappingStatus entry={entry} />
      </div>
    </header>
    <div className={styles.endpoints}>
      {entry.protocol === 'udp' ? <code className={styles.address}>{address}</code>
        : <ForwardedAddress entry={entry} onOpen={onOpen} />}
      <ArrowRight size={20} className={styles.direction} aria-hidden="true" /><code>{target}</code>
    </div>
    <footer className={styles.mappingBottom}>
      <MappingActions entry={entry} service={service} connected={connected} edit={edit} />
    </footer>
    {entry.error && <div className={styles.error} role="alert">{displayError(entry.error)}</div>}
  </article>;
}
