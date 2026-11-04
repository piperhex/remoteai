import { displayText, displayError } from '../../../../../shared/localization/uiText';
import { Alert, Button, Popconfirm, Space, Typography } from 'antd';
import { useDesktopSystemPermissions } from './useDesktopSystemPermissions';
import type { ComputerUsePermission } from '../../api/computerUse';
import { uiText } from "../../../../../shared/localization/uiText";
import { useGuiLanguage } from '../../../../../shared/localization/useGuiLanguage';

/** Presentation keys are resolved at render time so mounted views follow language changes. */
const PERMISSIONS: {
  key: ComputerUsePermission; title: string; description: string;
  enableLabel: string; repairTitle: string; repairLabel: string; repairDescription: string;
}[] = [
  { key: 'screenRecording', title: "client.desktopMacPermissions.screenRecording", description: "client.desktopMacPermissions.letsOtherDevicesSeeThisMacSScreen",
    enableLabel: "client.desktopMacPermissions.allowScreenRecording", repairTitle: "client.remoteDesktop.repairScreenRecordingPermission", repairLabel: "client.remoteDesktop.repairScreenRecordingPermission.4b032f",
    repairDescription: "client.remoteDesktop.thisClearsRemoteAiSScreenRecordingPermissionAndMay" },
  { key: 'accessibility', title: "client.desktopMacPermissions.accessibility", description: "client.desktopMacPermissions.allowsRemoteControlOfTheMouseAndKeyboard",
    enableLabel: "client.desktopMacPermissions.allowAccessibility", repairTitle: "client.remoteDesktop.repairAccessibilityPermission", repairLabel: "client.remoteDesktop.repairAccessibilityPermission.2506de",
    repairDescription: "client.remoteDesktop.thisClearsRemoteAiSAccessibilityPermissionAndMayInterrupt" },
];

export function DesktopSystemPermissions({ active }: { active: boolean }) {
  useGuiLanguage();
  const { permissions, error, busy, request, repair, restart } = useDesktopSystemPermissions(active);
  if (!permissions) return null;
  const needsRestart = !!permissions.restartRequired?.length;
  return <Space direction="vertical" style={{ width: '100%', maxWidth: 400 }}>
    <Typography.Text strong>{uiText("client.desktopMacPermissions.macPermissions")}</Typography.Text>
    {PERMISSIONS.map(({ key, title, description, enableLabel, repairTitle, repairLabel, repairDescription }) => {
      const repaired = permissions.restartRequired?.includes(key);
      return <div key={key}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>{displayText(title)}<div><Typography.Text type="secondary">{displayText(description)}</Typography.Text></div></div>
          {permissions[key] ? <span style={{ flexShrink: 0 }}>{uiText("client.settings.on")}</span>
            : <Button disabled={busy || !active} onClick={() => void request(key)}
              aria-label={displayText(enableLabel)}>{uiText("client.desktopMacPermissions.allow")}</Button>}
        </div>
        {repaired ? <Typography.Text type="secondary">{uiText("client.remoteDesktop.allowAccessAgainThenRestartTheApp")}</Typography.Text>
          : <Popconfirm title={displayText(repairTitle)} open={active ? undefined : false}
            description={displayText(repairDescription)}
            okText={uiText("client.remoteDesktop.resetAndAllowAccess")} cancelText={uiText("client.accounts.cancel")} disabled={busy || !active}
            styles={{ root: { maxWidth: 400 } }}
            onConfirm={() => repair(key)}>
            <Button type="link" size="small" disabled={busy || !active}
              aria-label={displayText(repairLabel)} style={{ paddingInline: 0 }}>{uiText("client.remoteDesktop.enabledButNotWorkingRepairPermissions")}</Button>
          </Popconfirm>}
      </div>;
    })}
    {needsRestart && <Alert type="info" showIcon message={uiText("client.remoteDesktop.permissionResetAllowAccessAgain")}
      description={<Space direction="vertical" size={8}>
        <span>{uiText("client.remoteDesktop.allowTheSelectedPermissionForRemoteAiInSystemSettings")}</span>
        <Button disabled={busy || !active} onClick={() => void restart()}>{uiText("client.remoteDesktop.restartAfterAllowingAccess")}</Button>
      </Space>} />}
    <Typography.Text type="secondary">{uiText("client.desktopMacPermissions.allowThesePermissionsForRemoteAiThenReconnectIfThe")}</Typography.Text>
    <Typography.Text type="secondary">
      {uiText("client.remoteDesktop.ifAnUpdateOrRenamePreventsConnectionTryRepairingPermissions")}
    </Typography.Text>
    <Typography.Text type="secondary">{uiText("client.desktopMacPermissions.computerAudioIsnTSupportedOnMacYetStaySigned")}</Typography.Text>
    {!!error && <Alert type="error" message={displayError(error)} />}
  </Space>;
}
