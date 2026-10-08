import { useState } from "react";
import { Alert, Button, Modal } from "antd";
import { Download, ExternalLink, FileUp } from "lucide-react";
import { guiText } from "../../i18n/guiText";
import type { CliSnapshot } from "./cliManualDownloadApi";
import { useCliManualDownload } from "./useCliManualDownload";
import styles from "./CliManualDownload.module.less";

interface Props { version: string | null; onImported: (value: CliSnapshot) => Promise<void>; disabled?: boolean }

export function CliManualDownload(props: Props) {
  const [selection, setSelection] = useState<{ version: string | null } | null>(null);
  return <>
    <Button icon={<Download size={15} />} disabled={props.disabled}
      onClick={() => setSelection({ version: props.version })}>
      {guiText("手动下载")}
    </Button>
    {selection && <DownloadDialog {...props} version={selection.version} onClose={() => setSelection(null)} />}
  </>;
}

function DownloadDialog({ version, onImported, onClose }: Props & { onClose: () => void }) {
  const state = useCliManualDownload(version, onImported);
  const { links, busy, result } = state;
  const staged = result?.release?.ready;
  return <Modal open centered title={guiText("手动下载 Codex")} width={448} className={styles.dialog}
    onCancel={onClose} closable={!busy} maskClosable={!busy} keyboard={!busy}
    footer={<div className={styles.actions}>
      <Button disabled={busy} onClick={onClose}>{guiText("关闭")}</Button>
      <Button type="primary" icon={<FileUp size={15} />} loading={state.importing}
        disabled={busy || !state.packagePath || !state.metadataPath || Boolean(result)}
        onClick={() => void state.importFiles()}>{guiText("导入并安装")}</Button>
    </div>}>
    <div className={styles.content}>
      <p>{guiText("下载下面两个文件，无需解压。下载完成后，分别选择文件并导入。")}</p>
      {links && <>
        <div className={styles.platform}>{guiText("适用于 {platform}", { platform: links.platform })}
          {version && <span> · Codex {version}</span>}</div>
        <FileStep title={guiText("1. 完整安装包")} href={links.packageUrl}
          description={links.assetName} selected={state.packagePath} disabled={busy}
          onChoose={() => void state.choose("package")} />
        <FileStep title={guiText("2. 版本校验文件")} href={links.metadataUrl}
          description={guiText("打开链接后，将页面另存为 JSON 文件，用于检查安装包是否完整。")}
          selected={state.metadataPath} disabled={busy} onChoose={() => void state.choose("metadata")} />
        <a href={links.releaseUrl} target="_blank" rel="noopener noreferrer" className={styles.release}>
          <ExternalLink size={14} />{guiText("官方发布页")}</a>
      </>}
      {!links && !state.error && <p role="status">{guiText("正在准备下载链接…")}</p>}
      <p className={styles.note}>{guiText("两个文件须来自同一版本。导入无需联网；有对话正在运行时，更新会稍后安装。")}</p>
      {state.importing && <p role="status">{guiText("正在检查文件并导入，请稍候…")}</p>}
      {state.error && <Alert type="error" showIcon message={state.error} />}
      {result && <Alert type="success" showIcon message={guiText(staged
        ? "导入成功，更新将在空闲时或下次启动时安装。" : "Codex 已安装，可以开始使用了。")} />}
    </div>
  </Modal>;
}

function FileStep({ title, description, href, selected, disabled, onChoose }: {
  title: string; description: string; href: string; selected: string; disabled: boolean; onChoose: () => void;
}) {
  const filename = selected.split(/[\\/]/).pop();
  return <section className={styles.file}>
    <strong>{title}</strong>
    <p>{description}</p>
    <div className={styles.actions}>
      <Button icon={<ExternalLink size={14} />} href={href} target="_blank" rel="noopener noreferrer">
        {guiText("下载文件")}</Button>
      <Button icon={<FileUp size={14} />} disabled={disabled} onClick={onChoose}>
        {guiText(selected ? "重新选择" : "选择文件")}</Button>
    </div>
    {selected && <div className={styles.selected}>{guiText("已选择：{filename}", { filename: filename || selected })}</div>}
  </section>;
}
