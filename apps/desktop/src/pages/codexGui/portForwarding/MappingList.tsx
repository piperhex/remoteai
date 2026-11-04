import { Button } from 'antd';
import { Cable, Plus } from 'lucide-react';
import { uiText as t } from "../../../../../../shared/localization/uiText";
import { MappingRow } from './MappingRow';
import type { ForwardingEntry, PortForwardingService } from './service';
import styles from './portForwarding.module.less';

export function MappingList({ entries, service, connected, create, edit, onOpen }: {
  entries: ForwardingEntry[]; service: PortForwardingService; connected: boolean;
  create: () => void; edit: (entry: ForwardingEntry) => void; onOpen: () => void;
}) {
  if (!entries.length) return <div className={styles.empty}>
    <Cable size={32} aria-hidden="true" />
    <span>{t("client.portForwarding.noPortMappingsYet")}</span>
    <Button type="primary" className={styles.create} icon={<Plus size={16} aria-hidden="true" />}
      onClick={create}>{t("client.portMappingEditing.newMapping")}</Button>
  </div>;
  return <>
    <div className={styles.columns} aria-hidden="true">
      <span>{t("client.portMappingEditing.localAccess")}</span><span /><span>{t("client.portMappingEditing.remoteTarget")}</span>
    </div>
    <div className={styles.list}>
      {entries.map(entry => <MappingRow key={entry.id} entry={entry} service={service}
        connected={connected} edit={() => edit(entry)} onOpen={onOpen} />)}
    </div>
  </>;
}
