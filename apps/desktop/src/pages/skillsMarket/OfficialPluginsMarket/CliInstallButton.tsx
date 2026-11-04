import { Button, Popover, Progress } from "antd";
import { Download } from "lucide-react";
import { uiText } from "../../../../../../shared/localization/uiText";
import type { useCliInstaller } from "../../codexGui/useCliInstaller";

export function CliInstallButton({ installer }: { installer: ReturnType<typeof useCliInstaller> }) {
  const { checked, version, release, checking, installing, progress, install, check } = installer;
  if (version) return null;
  const percent = progress ? Math.floor(progress.downloaded / Math.max(progress.total, 1) * 100) : 0;
  const content = <div style={{ maxWidth: 360 }}>
    <p>{uiText("client.desktopBuiltinPlugins.installCodexToBrowseAndManageOfficialPlugins")}</p>
    {release && !installing && <span>{uiText("client.desktopBuiltinPlugins.versionAboutMb", {
      value1: release.version, value2: Math.ceil(release.size / 1024 / 1024),
    })}</span>}
    {installing && <Progress percent={percent} size="small" status="active" />}
  </div>;
  return <Popover content={content} overlayStyle={{ maxWidth: 400 }}>
    <Button icon={<Download size={16} />} loading={!checked || checking || installing}
      onClick={() => void (release ? install() : check())}>
      {uiText(installing ? "client.desktopBuiltinPlugins.installingCodex" : "client.desktopBuiltinPlugins.installCodex")}
    </Button>
  </Popover>;
}
