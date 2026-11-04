import { uiText } from "../../../../../shared/localization/uiText";
import { useRef, useState } from "react";
import { Button, Input, Modal, type InputRef } from "antd";
import { Folder, FolderPlus } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { isDesktopApp } from "../../api/backend";
import { folderName, type SavedProject } from "../../../../../shared/conversation/projectCatalog";
import { useProjectFolderDrop } from "./useProjectFolderDrop";
import styles from "./CreateProjectDialog.module.less";

export function CreateProjectDialog({ disabled, onCreate, onClose, onError }: {
  disabled: boolean; onCreate: (project: SavedProject) => void; onClose: () => void;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [choosing, setChoosing] = useState(false);
  const input = useRef<InputRef>(null);
  const folder = useRef<HTMLButtonElement>(null);
  const setFolder = (selected: string) => {
    setPath(selected);
    setName((current) => current.trim() ? current : folderName(selected));
  };
  const drop = useProjectFolderDrop({ target: folder, enabled: !disabled && !choosing,
    onFolder: setFolder, onError });
  const busy = disabled || choosing || drop.reading;
  const confirm = () => {
    if (!busy && name.trim() && path.trim()) onCreate({ name: name.trim(), path: path.trim() });
  };
  const chooseFolder = async () => {
    if (busy) return;
    setChoosing(true);
    try {
      const selected = await open({ directory: true, multiple: false, title: uiText("client.composer.chooseSourceFolder") });
      if (typeof selected === "string") setFolder(selected);
    } catch (error) { onError(error); }
    finally { setChoosing(false); }
  };
  return <Modal open centered title={uiText("client.composer.createProject")} width={640} className={styles.dialog}
    onCancel={onClose} maskClosable={!choosing} keyboard={!choosing} closable={!choosing}
    afterOpenChange={(visible) => { if (visible) input.current?.focus(); }}
    footer={<div className={styles.actions}>
      <Button type="text" disabled={choosing} onClick={onClose}>{uiText("client.accounts.cancel")}</Button>
      <Button className={styles.create} type="primary" disabled={busy || !name.trim() || !path.trim()}
        onClick={confirm}>{uiText("client.composer.createProject")}</Button>
    </div>}>
    <Input ref={input} className={styles.name} prefix={<Folder size={19} aria-hidden="true" />}
      aria-label={uiText("client.composer.projectName")} placeholder={uiText("client.composer.projectName")} value={name} maxLength={120} disabled={busy}
      onChange={(event) => setName(event.target.value)} onPressEnter={confirm} />
    <div className={styles.label}>{uiText("client.composer.sourceFolder")}</div>
    {isDesktopApp ? <button ref={folder} type="button" className={styles.folder} disabled={busy}
      data-dragging={drop.dragging || undefined} aria-busy={drop.reading}
      onClick={() => void chooseFolder()}>
      <FolderPlus size={23} aria-hidden="true" />
      {path ? <><strong>{folderName(path)}</strong><span className={styles.path}>{path}</span>
        <small>{uiText("client.composer.clickOrDropAnotherFolderToChangeIt")}</small></> : <span>
        {choosing || drop.reading ? uiText("client.downloads.readingFolder") : uiText("client.composer.dropAFolderHereOrClickToChoose")}</span>}
    </button> : <div className={styles.hostFolder}>
      <Input aria-label={uiText("client.composer.sourceFolderPath")} placeholder={uiText("client.composer.enterTheFullPathToTheSourceFolder")} value={path} disabled={busy}
        onChange={(event) => setPath(event.target.value)} onPressEnter={confirm} />
      <p>{uiText("client.composer.enterTheFolderPathOnTheComputerRunningRemoteAi")}</p>
    </div>}
  </Modal>;
}
