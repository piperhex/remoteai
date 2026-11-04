import { guiLocale, uiText } from "../../../../../shared/localization/uiText";
import { useState, useSyncExternalStore } from "react";
import { Popover } from "antd";
import { mobileConnection } from "../../remoteChat/mobileConnection";
import { connectionDetails } from "../../remoteChat/connectionDetails";
import { formatRelayBytes } from "../../../../../shared/remote-chat/relayUsage";
import styles from "./MobileConnectionStatus.module.less";

export function MobileConnectionStatus() {
  const [open, setOpen] = useState(false);
  const connected = useSyncExternalStore(mobileConnection.subscribe, mobileConnection.getSnapshot);
  const details = useSyncExternalStore(connectionDetails.subscribe, connectionDetails.getSnapshot);
  const active = details.devices.filter((device) => device.mode !== 'offline');
  const content = <div className={styles.details}>
    <strong>{uiText("client.conversation.deviceConnections")}</strong>
    {!active.length && <p className={styles.muted}>{uiText("client.conversation.noDevicesAreConnectedToThisComputer")}</p>}
    <div className={styles.devices}>{active.map((device) => <section key={device.id} className={styles.device}>
      <div className={styles.heading}><strong>{device.name}</strong>
        <span className={styles.mode} data-mode={device.mode}>
          {device.mode === 'direct' ? uiText("client.conversation.p2pDirect") : device.mode === 'relay' ? uiText("client.conversation.relay") : uiText("client.conversation.connecting")}
        </span>
      </div>
      <div className={styles.muted}>{device.platform || uiText("client.app.devices")} · {device.id.slice(0, 8)} ·
        {' '}{new Date(device.connectedAt).toLocaleTimeString(guiLocale(), { hour: '2-digit', minute: '2-digit' })}  {uiText("client.conversation.connection")}</div>
      <div>{uiText("client.conversation.relayedThisSession")}{device.uploadBytes === undefined || device.downloadBytes === undefined ? uiText("client.conversation.waitingForUsageData")
        : formatRelayBytes(device.uploadBytes + device.downloadBytes)}</div>
      {device.uploadBytes !== undefined && device.downloadBytes !== undefined && <div className={styles.muted}>
        {uiText("client.conversation.sent")}{formatRelayBytes(device.uploadBytes)}  {uiText("client.conversation.received")} {formatRelayBytes(device.downloadBytes)}
      </div>}
    </section>)}</div>
    {details.usage && <section className={styles.allowance}>
      <strong>{uiText("client.conversation.accountRelayUsageThisMonth")}</strong>
      <div>{formatRelayBytes(details.usage.monthUsedBytes)} / {details.usage.monthlyLimitBytes === -1
        ? uiText("client.conversation.unlimited") : formatRelayBytes(details.usage.monthlyLimitBytes)}</div>
      <p className={styles.muted}>{uiText("client.conversation.theQuotaResetsOnTheFirstDayOfEachMonth")}</p>
    </section>}
    {details.blocked && <p className={styles.warning}>{uiText("client.conversation.theRelayServerIsUnavailableUseADirectP2pConnection")}</p>}
    <p className={styles.muted}>{uiText("client.conversation.onlyServerRelayTrafficIsCountedDirectP2pTrafficIs")}</p>
  </div>;
  return <Popover trigger="click" placement="bottomRight" arrow={false} content={content}
    open={open} onOpenChange={setOpen} styles={{ body: { maxWidth: 400 } }}>
    <button type="button" className={styles.status} aria-label={uiText("client.conversation.viewDeviceConnectionDetails")}
      aria-expanded={open} data-connected={connected}>
    <span className={styles.dot} aria-hidden="true" />
    {connected ? uiText("client.conversation.otherDevicesConnected") : uiText("client.conversation.noDevicesConnected")}
    </button>
  </Popover>;
}
