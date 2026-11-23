import { displayText, displayError } from '../../../../../../shared/localization/uiText';
import { MappingActions } from './MappingActions';
import { ArrowRight } from 'lucide-react';
import { ForwardedAddress } from './ForwardedAddress';
import { protocolLabel } from '../../../../../../shared/port-mapping/settings';
import { mappingAddress } from '../../../../../../shared/port-mapping/target';
import type { ForwardingEntry, PortForwardingService } from './service';
import styles from './portForwarding.module.less';

const STATUS_TEXT = { stopped: "client.chat.stopped", starting: "client.portForwarding.starting", running: "client.portForwarding.active",
  stopping: "client.portForwarding.stopping", error: "client.portForwarding.couldNotStart" } as const;

export function MappingStatus({ entry }: { entry: ForwardingEntry }) {
  return <span className={styles.status} data-state={entry.status} role="status">
    {displayText(STATUS_TEXT[entry.status])}
  </span>;
}

export function MappingRow({ entry, service, connected, onOpen, edit }: {
  entry: ForwardingEntry; service: PortForwardingService; connected: boolean; onOpen: () => void; edit: () => void;
}) {
  const running = entry.status === 'running';
  const target = mappingAddress(entry);
  const label = `127.0.0.1:${entry.localPort} → ${target}`;
  return <article className={styles.mapping} aria-label={label}>
    <div className={styles.endpoints}>
      {entry.protocol === 'udp' ? <code className={styles.address}>127.0.0.1:{entry.localPort}</code>
        : <ForwardedAddress port={entry.localPort} running={running} onOpen={onOpen} />}
      <ArrowRight size={20} className={styles.direction} aria-hidden="true" /><code>{target}</code>
    </div>
    <div className={styles.mappingBottom}>
      <div className={styles.metadata}>
        <span className={styles.protocol}>{protocolLabel(entry.protocol)}</span>
        <MappingStatus entry={entry} />
      </div>
      <MappingActions entry={entry} service={service} connected={connected} edit={edit} />
    </div>
    {entry.error && <div className={styles.error} role="alert">{displayError(entry.error)}</div>}
  </article>;
}
