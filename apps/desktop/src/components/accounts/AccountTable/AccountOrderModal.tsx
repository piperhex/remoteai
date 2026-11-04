import { useState } from "react";
import { Alert, Button, Modal, Tag } from "antd";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import type { Language } from "../../../i18n";
import type { Account } from "../../../types";
import { maskAccountEmail } from "../../../../../../shared/accounts/privacy";
import { applyAccountOrder, moveAccount } from "./accountOrder";
import { accountOrderLabels } from "@remoteai/i18n/copy/desktop/accountOrderLabels";
import { useAccountOrderDrag } from "./useAccountOrderDrag";
import styles from "./AccountOrderModal.module.less";

interface AccountOrderModalProps {
  accounts: Account[];
  privacyMode: boolean;
  hideAccountNotes: boolean;
  language: Language;
  onClose: () => void;
  onSave: (ids: string[]) => void;
}

export function AccountOrderModal({
  accounts, privacyMode, hideAccountNotes, language, onClose, onSave,
}: AccountOrderModalProps) {
  const labels = accountOrderLabels(language);
  const [draft, setDraft] = useState(() => accounts.map((account) => account.id));
  const [saveError, setSaveError] = useState(false);
  const ordered = applyAccountOrder(accounts, draft);
  const ids = ordered.map((account) => account.id);
  const reorder = (source: string, target: string) => setDraft(moveAccount(ids, source, target));
  const drag = useAccountOrderDrag(reorder);
  const moveBy = (index: number, offset: number) => {
    const target = ids[index + offset];
    if (target) reorder(ids[index], target);
  };
  const save = () => {
    try {
      onSave(ids);
      onClose();
    } catch {
      setSaveError(true);
    }
  };
  return <Modal open centered maskClosable={false} width={448} title={labels.title} onCancel={onClose}
    onOk={save} okText={labels.save} cancelText={labels.cancel}>
    <p className={styles.hint}>{labels.hint}</p>
    {saveError && <Alert type="error" showIcon message={labels.error} className={styles.error} />}
    <ol ref={drag.listRef} className={styles.list} aria-label={labels.title}>
      {ordered.map((account, index) => {
        const email = privacyMode ? maskAccountEmail(account.email) : account.email;
        const isTarget = drag.target === account.id && drag.source !== account.id;
        const targetClass = ids.indexOf(drag.source ?? "") < index ? styles.dropAfter : styles.dropBefore;
        return <li key={account.id} data-account-order-id={account.id}
          className={[styles.row, drag.source === account.id ? styles.dragging : "",
            isTarget ? targetClass : ""].filter(Boolean).join(" ")}>
          <button type="button" className={styles.handle} aria-label={`${labels.drag}: ${email}`}
            onPointerDown={(event) => drag.start(event, account.id)} onPointerMove={drag.move}
            onPointerUp={drag.drop} onPointerCancel={drag.stop} onLostPointerCapture={drag.stop}
            onKeyDown={(event) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              moveBy(index, event.key === "ArrowUp" ? -1 : 1);
            }}>
            <GripVertical size={18} aria-hidden="true" />
          </button>
          <span className={styles.position}>{index + 1}</span>
          <div className={styles.identity}>
            <span className={styles.email} title={email}>{email}</span>
            {!hideAccountNotes && account.note && <span className={styles.note}>{account.note}</span>}
            {account.plan && <Tag className={styles.plan}>{account.plan}</Tag>}
          </div>
          <div className={styles.actions}>
            <Button type="text" size="small" icon={<ArrowUp size={14} />} disabled={index === 0}
              aria-label={`${labels.up}: ${email}`} onClick={() => moveBy(index, -1)} />
            <Button type="text" size="small" icon={<ArrowDown size={14} />} disabled={index === ids.length - 1}
              aria-label={`${labels.down}: ${email}`} onClick={() => moveBy(index, 1)} />
          </div>
        </li>;
      })}
    </ol>
  </Modal>;
}
