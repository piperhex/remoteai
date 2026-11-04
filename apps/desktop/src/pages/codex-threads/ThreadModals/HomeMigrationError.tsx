import { useState } from "react";
import { Alert, Button } from "antd";
import { formatRemoteError } from "../../../../../../shared/localization/errors";
import { useGuiLanguage } from "../../../../../../shared/localization/useGuiLanguage";
import { copyText } from "../../../../../../shared/clipboard";
import type { ThreadCopy } from "@remoteai/i18n/copy/desktop/threads";

export function HomeMigrationError({ error, text }: { error: string; text: ThreadCopy }) {
  const language = useGuiLanguage();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      // The copied report keeps the original backend text for troubleshooting.
      await copyText(error);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };
  return <Alert type="error" style={{ marginTop: 12, maxWidth: 400 }}
    message={<div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {formatRemoteError(language, error)}
    </div>}
    description={<>
      <Button size="small" onClick={() => void copy()}>
        {copyStatus === "copied" ? text.homeMigrationErrorCopied : text.homeMigrationCopyError}
      </Button>
      {copyStatus === "failed" && <div role="status">{text.homeMigrationCopyFailed}</div>}
    </>} />;
}
