import { Button, Popconfirm, Tooltip, message } from 'antd';
import { Copy, Play, Square, Trash2 } from 'lucide-react';
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

export function MappingActions({ entry, service, connected, local }: {
  entry: ForwardingEntry; service: PortForwardingService; connected: boolean; local?: boolean;
}) {
  const busy = entry.status === 'starting' || entry.status === 'stopping';
  const stopAction = entry.status === 'running' || busy;
  const address = localMappingAddress(entry);
  const label = `${address} → ${mappingAddress(entry)}`;
  const remove = t('client.portForwarding.removeMapping');
  const cancel = t('client.accounts.cancel');
  return <div className={styles.rowActions}>
    <Tooltip title={t("client.portForwarding.copyLocalAddress")} styles={{ root: { maxWidth: 400 } }}>
      <Button type="text" aria-label={`${t("client.portForwarding.copyLocalAddress")} ${label}`} icon={<Copy size={18} />}
        onClick={() => { void copyAddress(address); }} />
    </Tooltip>
    <Popconfirm title={t('client.mobile.confirmDeletion')} description={label} okText={remove} cancelText={cancel}
      styles={{ root: { maxWidth: 'min(400px, calc(100vw - 16px))', overflowWrap: 'anywhere' } }}
      okButtonProps={{ danger: true }} cancelButtonProps={{ 'aria-label': cancel }}
      onConfirm={() => service.remove(entry.id)}>
      <Button type="text" title={remove} aria-label={`${remove} ${label}`} icon={<Trash2 size={18} />}
        disabled={entry.status === 'stopping'} />
    </Popconfirm>
    {!local && <><span className={styles.actionDivider} aria-hidden="true" />
    <Button className={styles.toggle} variant="solid" color={stopAction ? 'red' : 'green'}
      loading={entry.status === 'stopping'} disabled={entry.status === 'stopping' || (!connected && !stopAction)}
      aria-label={`${t(stopAction ? "client.portForwarding.stopMapping" : "client.portForwarding.startMapping")} ${label}`}
      icon={stopAction ? <Square size={16} /> : <Play size={18} />}
      onClick={() => { void (stopAction ? service.stop(entry.id) : service.start(entry.id)); }}>
      {t(stopAction ? "client.shared.stop" : "client.portForwarding.start")}</Button></>}
  </div>;
}
