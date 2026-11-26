import { Button, Dropdown, Tooltip, message } from 'antd';
import { Copy, MoreHorizontal, Pencil, Play, Square, Trash2 } from 'lucide-react';
import { uiText as t } from '../../../../../../shared/localization/uiText';
import { copyText } from '../../../../../../shared/clipboard';
import { localMappingAddress, mappingAddress } from '../../../../../../shared/port-mapping/target';
import type { ForwardingEntry, PortForwardingService } from './service';
import styles from './portForwarding.module.less';

async function copyAddress(address: string) {
  try {
    await copyText(address);
    void message.success({ content: t("client.portForwarding.localAddressCopied"), style: { maxWidth: 400, marginInline: 'auto' } });
  } catch { void message.error({ content: t("client.chat.couldNotCopyTryAgain"), style: { maxWidth: 400, marginInline: 'auto' } }); }
}

export function MappingActions({ entry, service, connected, edit, rename }: {
  entry: ForwardingEntry; service: PortForwardingService; connected: boolean; edit: () => void; rename?: () => void;
}) {
  const busy = entry.status === 'starting' || entry.status === 'stopping';
  const stopAction = entry.status === 'running' || busy;
  const address = localMappingAddress(entry);
  const label = `${address} → ${mappingAddress(entry)}`;
  return <div className={styles.rowActions}>
    <Tooltip title={t("client.portForwarding.copyLocalAddress")} styles={{ root: { maxWidth: 400 } }}>
      <Button type="text" aria-label={`${t("client.portForwarding.copyLocalAddress")} ${label}`} icon={<Copy size={18} />}
        onClick={() => { void copyAddress(address); }} />
    </Tooltip>
    <Tooltip title={t("client.portMappingEditing.editMapping")} styles={{ root: { maxWidth: 400 } }}>
      <Button type="text" aria-label={`${t("client.portMappingEditing.editMapping")} ${label}`} icon={<Pencil size={18} />}
        disabled={busy} onClick={edit} />
    </Tooltip>
    <Dropdown trigger={['click']} overlayStyle={{ maxWidth: 400, overflowWrap: 'anywhere' }}
      menu={{ items: [...(rename ? [{ key: 'rename', label: t('client.mappingEditor.editAlias'), onClick: rename }] : []),
        { key: 'remove', label: t("client.portForwarding.removeMapping"), icon: <Trash2 size={16} />, danger: true,
        disabled: entry.status === 'stopping', onClick: () => { void service.remove(entry.id); } }] }}>
      <Button type="text" aria-label={`${t("client.portMappingEditing.moreActions")} ${label}`} aria-haspopup="menu"
        icon={<MoreHorizontal size={20} />} />
    </Dropdown>
    <span className={styles.actionDivider} aria-hidden="true" />
    <Button className={styles.toggle} variant="solid" color={stopAction ? 'red' : 'green'}
      loading={entry.status === 'stopping'} disabled={entry.status === 'stopping' || (!connected && !stopAction)}
      aria-label={`${t(stopAction ? "client.portForwarding.stopMapping" : "client.portForwarding.startMapping")} ${label}`}
      icon={stopAction ? <Square size={16} /> : <Play size={18} />}
      onClick={() => { void (stopAction ? service.stop(entry.id) : service.start(entry.id)); }}>
      {t(stopAction ? "client.shared.stop" : "client.portForwarding.start")}</Button>
  </div>;
}
