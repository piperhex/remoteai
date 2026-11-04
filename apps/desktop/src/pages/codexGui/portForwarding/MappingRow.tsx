import { displayText, displayError } from '../../../../../../shared/localization/uiText';
import { Button, Dropdown, Tooltip, message } from 'antd';
import { ArrowRight, Copy, MoreHorizontal, Pencil, Play, Square, Trash2 } from 'lucide-react';
import { uiText as t } from "../../../../../../shared/localization/uiText";
import { copyText } from '../../../../../../shared/clipboard';
import { ForwardedAddress } from './ForwardedAddress';
import { protocolLabel } from '../../../../../../shared/port-mapping/settings';
import { mappingAddress } from '../../../../../../shared/port-mapping/target';
import type { ForwardingEntry, PortForwardingService } from './service';
import styles from './portForwarding.module.less';

const STATUS_TEXT = { stopped: "client.chat.stopped", starting: "client.portForwarding.starting", running: "client.portForwarding.active",
  stopping: "client.portForwarding.stopping", error: "client.portForwarding.couldNotStart" } as const;

async function copyAddress(port: number) {
  try {
    await copyText(`127.0.0.1:${port}`);
    void message.success({ content: t("client.portForwarding.localAddressCopied"), style: { maxWidth: 400, marginInline: 'auto' } });
  } catch { void message.error({ content: t("client.chat.couldNotCopyTryAgain"), style: { maxWidth: 400, marginInline: 'auto' } }); }
}

export function MappingRow({ entry, service, connected, onOpen, edit }: {
  entry: ForwardingEntry; service: PortForwardingService; connected: boolean; onOpen: () => void; edit: () => void;
}) {
  const busy = entry.status === 'starting' || entry.status === 'stopping';
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
        <span className={styles.status} data-state={entry.status} role="status">{displayText(STATUS_TEXT[entry.status])}</span>
      </div>
      <div className={styles.rowActions}>
        <Tooltip title={t("client.portForwarding.copyLocalAddress")} styles={{ root: { maxWidth: 400 } }}>
          <Button type="text" aria-label={`${t("client.portForwarding.copyLocalAddress")} ${label}`} icon={<Copy size={18} />}
            onClick={() => { void copyAddress(entry.localPort); }} />
        </Tooltip>
        <Tooltip title={t("client.portMappingEditing.editMapping")} styles={{ root: { maxWidth: 400 } }}>
          <Button type="text" aria-label={`${t("client.portMappingEditing.editMapping")} ${label}`} icon={<Pencil size={18} />}
            disabled={busy} onClick={edit} />
        </Tooltip>
        <Dropdown trigger={['click']} overlayStyle={{ maxWidth: 400, overflowWrap: 'anywhere' }}
          menu={{ items: [{ key: 'remove', label: t("client.portForwarding.removeMapping"), icon: <Trash2 size={16} />, danger: true,
            disabled: entry.status === 'stopping', onClick: () => { void service.remove(entry.id); } }] }}>
          <Button type="text" aria-label={`${t("client.portMappingEditing.moreActions")} ${label}`} aria-haspopup="menu"
            icon={<MoreHorizontal size={20} />} />
        </Dropdown>
        <span className={styles.actionDivider} aria-hidden="true" />
        <Button className={styles.toggle} loading={entry.status === 'stopping'}
          disabled={entry.status === 'stopping' || (!connected && !running && !busy)}
          aria-label={`${t(running || busy ? "client.portForwarding.stopMapping" : "client.portForwarding.startMapping")} ${label}`}
          icon={running || busy ? <Square size={16} /> : <Play size={18} />}
          onClick={() => { void (running || busy ? service.stop(entry.id) : service.start(entry.id)); }}>
          {t(running || busy ? "client.shared.stop" : "client.portForwarding.start")}</Button>
      </div>
    </div>
    {entry.error && <div className={styles.error} role="alert">{displayError(entry.error)}</div>}
  </article>;
}
