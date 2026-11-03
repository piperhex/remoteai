import { useEffect, useState } from "react";
import { Button, message } from "antd";
import { Check, Copy } from "lucide-react";
import { useDiffText } from "../../../../../shared/chat/diffText";

const COPY_FEEDBACK_MS = 1800;

export function CopyButton({ text, label = "client.chat.copyMessage", showLabel = false }: {
  text: string | (() => string); label?: string; showLabel?: boolean;
}) {
  const t = useDiffText();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return <Button type="text" size="small" aria-label={t(copied ? "client.chat.copied" : label)}
    style={showLabel ? { color: "inherit" } : undefined}
    icon={copied ? <Check size={14} /> : <Copy size={14} />}
    onClick={() => void navigator.clipboard.writeText(typeof text === "function" ? text() : text)
      .then(() => setCopied(true)).catch(() => {
        setCopied(false);
        void message.error({ content: t("client.chat.copyFailedSelectTheTextAndCopyItManually"), style: { maxWidth: 400, marginInline: "auto" } });
      })}>{showLabel ? t(copied ? "client.chat.copied" : label) : undefined}</Button>;
}
