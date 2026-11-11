import {
  ClipboardPaste, ExternalLink, FileInput, Globe2, LayoutGrid, X,
} from "lucide-react";
import { Button, Modal } from "antd";
import { useState } from "react";
import { isHostedWebApp } from "../../api/backend";
import { PasteAccountModal } from "./PasteAccountModal";
import type { Translate } from "../../i18n";
import { AccountLoginChoice, AccountLoginHeader } from '../../../../../shared/accounts/AccountLoginChoice';

export function LoginModal({ onClose, onWebSession, onStart, onImport, onImportClipboard, onImportText, t }: {
  onClose: () => void;
  onWebSession: () => void;
  onStart: (embedded: boolean, privateMode?: boolean) => void;
  onImport: () => void;
  onImportClipboard: () => void;
  onImportText: (content: string) => Promise<boolean>;
  t: Translate;
}) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [browserModeConfirmOpen, setBrowserModeConfirmOpen] = useState(false);

  const confirmWebSession = () => {
    Modal.confirm({
      title: t("login.webSessionConfirmTitle"),
      content: <span className="login-web-session-warning">{t("login.webSessionConfirmDescription")}</span>,
      centered: true,
      okText: t("login.webSessionConfirmButton"),
      cancelText: t("login.webSessionCancelButton"),
      onOk: onWebSession,
    });
  };

  const startBrowserLogin = (privateMode: boolean) => {
    setBrowserModeConfirmOpen(false);
    onStart(false, privateMode);
  };

  return (
    <div className="modal-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label={t("login.close")} onClick={onClose}><X size={19} /></button>
        <AccountLoginHeader title={t(isHostedWebApp ? "login.importTitle" : "login.title")} />
        {!isHostedWebApp && <>
        <AccountLoginChoice title={t("login.browser.title")} description={t("login.browser.description")}
          icon={<ExternalLink size={20} />} onClick={() => setBrowserModeConfirmOpen(true)} />
        <AccountLoginChoice title={t("login.embedded.title")} description={t("login.embedded.description")}
          icon={<LayoutGrid size={20} />} featured onClick={() => onStart(true)} />
        </>}
        <AccountLoginChoice title={t("login.importMultiple")} description={t("login.importCompatible")}
          icon={<FileInput size={20} />} onClick={onImport} />
        <AccountLoginChoice title={t("login.importClipboard")} description={t("login.importClipboardDescription")}
          icon={<ClipboardPaste size={20} />} onClick={isHostedWebApp ? () => setPasteOpen(true) : onImportClipboard} />
        {!isHostedWebApp && <AccountLoginChoice title={t("login.webSession.title")}
          description={t("login.webSession.description")} icon={<Globe2 size={20} />} onClick={confirmWebSession} />}
      </section>
      {pasteOpen && <PasteAccountModal onClose={() => setPasteOpen(false)}
        onImported={onClose} onImport={onImportText} t={t} />}
      <Modal
        open={browserModeConfirmOpen}
        centered
        title={t("login.browserModeConfirmTitle")}
        width={400}
        onCancel={() => setBrowserModeConfirmOpen(false)}
        footer={[
          <Button key="normal" danger type="primary" onClick={() => startBrowserLogin(false)}>
            {t("login.browserNormalButton")}
          </Button>,
          <Button key="private" type="primary" onClick={() => startBrowserLogin(true)}>
            {t("login.browserPrivateButton")}
          </Button>,
        ]}
      >
        <p className="login-browser-mode-warning">{t("login.browserModeConfirmDescription")}</p>
      </Modal>
    </div>
  );
}
