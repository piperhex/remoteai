import { t, useLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText } from '../components/copyText';

const COPY_FEEDBACK_MS = 2000;

export function ChatCopyButton({ text, label = t("client.projectBrowser.copied"), iconOnly = false }: {
  text: string | (() => string); label?: string; iconOnly?: boolean;
}) {
  useLanguage();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    const success = await copyText(label.replace(/^(复制|Copy\s*)/, '') || t("client.chat.content"),
      typeof text === 'function' ? text() : text,
      { successToast: !iconOnly });
    if (iconOnly) setCopied(success);
  };
  return <button type="button" className={`chat-text-action${iconOnly ? ' chat-copy-icon' : ''}`}
    aria-label={copied ? t("client.chat.copied") : label} onClick={() => void copy()}>
    {copied ? <Check size={15} /> : <Copy size={15} />}{!iconOnly && <span>{label}</span>}
  </button>;
}
