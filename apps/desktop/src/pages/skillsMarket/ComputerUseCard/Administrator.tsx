import { ShieldCheck } from "lucide-react";
import { Checkbox, Modal } from "antd";
import { useState } from "react";
import type { ComputerUseAction, ComputerUseAdministrator } from "../../../api/computerUse";
import { displayError, uiText } from "../../../../../../shared/localization/uiText";
import styles from "./index.module.less";

interface Props {
  status: ComputerUseAdministrator;
  busy: boolean;
  error: string;
  onAction: (action: ComputerUseAction) => Promise<boolean>;
}

export function Administrator({ status, busy, error, onAction }: Props) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}
      aria-label={uiText("client.computerUseAdmin.title")} title={uiText("client.computerUseAdmin.title")}>
      <ShieldCheck size={16} />
    </button>
    <Modal open={open} title={uiText("client.computerUseAdmin.title")} footer={null} width={400}
      onCancel={() => setOpen(false)}>
    <div className={styles.administratorSettings}>
    <p>{uiText(status.inherited ? "client.computerUseAdmin.inherited"
      : status.active ? "client.computerUseAdmin.active" : "client.computerUseAdmin.inactive")}</p>
    {!status.inherited && <>
      <Checkbox checked={status.requested} disabled={busy}
        onChange={event => void onAction(event.target.checked ? "enableAdministrator" : "revokeAdministrator")}>
        {uiText("client.computerUseAdmin.allow")}
      </Checkbox>
      <p>{uiText("client.computerUseAdmin.explanation")}</p>
      {status.requested && status.attempted && !status.active && <div className={styles.permission}>
        <button disabled={busy} onClick={() => void onAction("grantAdministrator")}>
          {uiText("client.computerUseAdmin.retry")}
        </button>
      </div>}
    </>}
    {error && <div className={styles.error} role="alert">{displayError(error)}</div>}
    </div>
    </Modal>
  </>;
}
