import { guiText } from "../../i18n/guiText";
import { Button, Progress } from "antd";
import { Download, ExternalLink, RefreshCw, Terminal } from "lucide-react";
import { isDesktopApp } from "../../api/backend";
import type { useCliInstaller } from "./useCliInstaller";
import { CliManualDownload } from "./CliManualDownload";
import styles from "./styles.module.less";

export function Installer({ installer, compact = false, running = false, remote = false, disabled = false }: {
  installer: Omit<ReturnType<typeof useCliInstaller>, "onImported"> &
    Partial<Pick<ReturnType<typeof useCliInstaller>, "onImported">>; compact?: boolean; running?: boolean;
  remote?: boolean; disabled?: boolean;
}) {
  const { version, release, checking, installing, progress, checked, check, install } = installer;
  const available = release && release.version !== version;
  const description = version ? guiText("每 30 分钟自动检查并下载更新。下载完成后，若无进行中的对话就立即安装，否则等待后续检查或重启应用。")
    : guiText("下载 Codex 后，就能在这里开始对话、处理代码和管理任务。");
  return <div className={compact ? styles.installCompact : styles.install}>
    {!compact && <div className={styles.welcomeIcon}><Terminal size={30} /></div>}
    <h2>{version ? `Codex ${version}` : guiText("开始使用 Codex GUI")}</h2>
    <p>{remote && !version ? guiText("在当前远程电脑上检查和更新 Codex。") : description}</p>
    {!compact && <p className={styles.muted}>{isDesktopApp
      ? guiText("这里的对话独立保存，不会影响官方 Codex 的聊天记录。")
      : guiText("Codex 在运行 Remote AI 的主机上安装和运行，对话也保存在该主机。")}</p>}
    <div className={styles.installActions}>
      {available && <Button type="primary" icon={<Download size={16} />} loading={installing}
        disabled={running || disabled} onClick={() => void install()}>
        {version ? guiText("更新到") : guiText("下载并开始")} {release.version}
      </Button>}
      {!available && <Button loading={checking || !checked} icon={<RefreshCw size={15} />}
        disabled={installing || disabled} onClick={() => void check()}>{release && version ? guiText("已是最新版本") : guiText("检查版本")}</Button>}
      {isDesktopApp && !remote && installer.onImported && <CliManualDownload version={release?.version ?? null}
        disabled={installing || disabled} onImported={installer.onImported} />}
      <Button type="text" icon={<ExternalLink size={14} />} href="https://github.com/openai/codex/releases"
        target="_blank" rel="noopener noreferrer">{guiText("官方发布页")}</Button>
    </div>
    {available && !installing && <small>{release.ready
      ? guiText("更新已下载，无进行中的对话时会自动安装；若暂未安装，将在后续检查或重启应用时重试。")
      : guiText("下载约 {value1} MB", { value1: Math.ceil(release.size / 1024 / 1024) })}</small>}
    {running && available && <small>{guiText("当前任务完成后即可更新。")}</small>}
    {installing && <div className={styles.downloadProgress}>
      <Progress percent={progress ? Math.floor(progress.downloaded / Math.max(progress.total, 1) * 100) : 0}
        status="active" size="small" />
      <span>{progress?.phase === "installing" ? guiText("正在安装，即将完成…") : guiText("正在下载 Codex…")}</span>
    </div>}
  </div>;
}
