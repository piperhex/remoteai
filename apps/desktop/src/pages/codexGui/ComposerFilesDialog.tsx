import { uiText } from "../../../../../shared/localization/uiText";
import { useState } from "react";
import { Button, Input, Modal, Segmented } from "antd";
import { File, Folder, ImagePlus } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { isDesktopApp } from "../../api/backend";
import { folderName } from "../../../../../shared/conversation/projectCatalog";
import type { AttachmentReference } from "../../../../../shared/conversation/attachmentTypes";
import styles from "./ComposerExtras.module.less";

export function ComposerFilesDialog({ onAdd, onImages, onClose, onError }: {
  onAdd: (files: AttachmentReference[]) => void; onImages: () => void;
  onClose: () => void; onError: (message: string) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const [kind, setKind] = useState<"file" | "folder">("file");
  const [path, setPath] = useState("");
  const choose = async (kind: "file" | "folder") => {
    if (choosing) return;
    setChoosing(true);
    try {
      const selected = await open({ directory: kind === "folder", multiple: true,
        title: kind === "folder" ? uiText("client.composer.addFolder") : uiText("client.composer.addFile") });
      if (selected) {
        const paths = typeof selected === "string" ? [selected] : selected;
        onAdd(paths.map((path) => ({ kind, name: folderName(path), path })));
        onClose();
      }
    } catch { onError(uiText("client.composer.couldNotSelectTheFilePleaseTryAgainShortly")); }
    finally { setChoosing(false); }
  };
  const confirm = () => {
    if (!path.trim()) return;
    onAdd([{ kind, name: folderName(path.trim()), path: path.trim() }]); onClose();
  };
  return <Modal open centered title={uiText("client.composer.addFilesAndFolders")} width={400} footer={null} onCancel={onClose}
    closable={!choosing} maskClosable={!choosing} keyboard={!choosing}>
    <div className={styles.fileChoices}>
      <Button icon={<ImagePlus size={18} />} disabled={choosing} onClick={() => { onImages(); onClose(); }}>
        {uiText("client.composer.addImages")}</Button>
      {isDesktopApp ? <>
        <Button icon={<File size={18} />} disabled={choosing} onClick={() => void choose("file")}>{uiText("client.composer.addFile")}</Button>
        <Button icon={<Folder size={18} />} disabled={choosing} onClick={() => void choose("folder")}>{uiText("client.composer.addFolder")}</Button>
      </> : <>
        <Segmented value={kind} options={[{ label: uiText("client.chat.files.39932f"), value: "file" }, { label: uiText("client.git.folders"), value: "folder" }]}
          onChange={setKind} />
        <Input aria-label={uiText("client.composer.attachmentPath")} placeholder={uiText("client.composer.enterTheFullPath")} value={path}
          onChange={(event) => setPath(event.target.value)} onPressEnter={confirm} />
        <p className={styles.copy}>{uiText("client.composer.enterThePathToAFileOrFolderOnThe")}</p>
        <Button type="primary" disabled={!path.trim()} onClick={confirm}>{uiText("client.shared.add")}</Button>
      </>}
    </div>
  </Modal>;
}
