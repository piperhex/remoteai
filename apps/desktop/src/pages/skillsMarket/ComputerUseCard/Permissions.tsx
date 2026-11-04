import { displayText } from '../../../../../../shared/localization/uiText';
import type { ComputerUsePermission, ComputerUsePermissions } from "../../../api/computerUse";
import { uiText } from "../../../../../../shared/localization/uiText";
import styles from "./index.module.less";

interface Props {
  permissions: ComputerUsePermissions;
  busy: boolean;
  onRequest: (permission: ComputerUsePermission) => Promise<boolean>;
}

const PERMISSIONS: { key: ComputerUsePermission; label: string; enableLabel: string }[] = [
  { key: "accessibility", label: "client.desktopMacPermissions.accessibility", enableLabel: "client.desktopMacPermissions.allowAccessibility" },
  { key: "screenRecording", label: "client.desktopMacPermissions.screenRecording", enableLabel: "client.desktopMacPermissions.allowScreenRecording" },
];

export function Permissions({ permissions, busy, onRequest }: Props) {
  const ready = permissions.accessibility && permissions.screenRecording;
  return <div className={styles.permissions}>
    <p>{uiText(ready ? "client.desktopBuiltinPlugins.desktopControlPermissionsGranted" : "client.desktopBuiltinPlugins.allowThesePermissionsForRemoteAiInSystemSettings")}</p>
    {PERMISSIONS.map(({ key, label, enableLabel }) => <div className={styles.permission} key={key}>
      <span>{displayText(label)}</span>
      {permissions[key] ? <span>{uiText("client.settings.on")}</span> : <button disabled={busy}
        onClick={() => void onRequest(key)} aria-label={displayText(enableLabel)}>{uiText("client.desktopMacPermissions.allow")}</button>}
    </div>)}
    {!ready && <p>{uiText("client.desktopBuiltinPlugins.afterAllowingThemReopenTheChatIfTheSystemAsks")}</p>}
  </div>;
}
