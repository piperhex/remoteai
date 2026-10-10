import { syntaxColorRoles } from '../../../../shared/theme/syntax';
import { t, useLanguage } from '../i18n';
import { useMemo, useState } from 'react';
import { Code2, WrapText } from 'lucide-react';
import { highlightCode } from '../../../../shared/chat/codeHighlight';
import { ChatCopyButton } from './ChatCopyButton';

const PAGE_CHARACTERS = 8_000;
const LANGUAGE_LABELS: Record<string, string> = {
  typescript: 'TypeScript', ts: 'TypeScript', javascript: 'JavaScript', js: 'JavaScript',
  tsx: 'TSX', jsx: 'JSX', json: 'JSON', html: 'HTML', css: 'CSS', sql: 'SQL', python: 'Python',
  rust: 'Rust', powershell: 'PowerShell', bash: 'Bash', shell: 'Shell', get text() { return t("文本"); }, get plaintext() { return t("文本"); },
  diff: 'Diff', patch: 'Diff',
};

export function ChatCodeBlock({ text, language = '', label, copyLabel = t("复制代码"), desktop = false }: {
  text: string; language?: string; label?: string; copyLabel?: string; desktop?: boolean;
}) {
  useLanguage();
  const [limit, setLimit] = useState(PAGE_CHARACTERS);
  const [wrapped, setWrapped] = useState(false);
  // Bound highlighting and DOM work while progressively exposing the complete output.
  const visible = text.slice(0, limit);
  const spans = useMemo(() => highlightCode(visible, language), [visible, language]);
  const more = limit < text.length;
  return <section className="chat-code-block">
    <header><span>{desktop && <Code2 size={16} aria-hidden="true" />}
      {label || (desktop ? LANGUAGE_LABELS[language] : '') || language || t("代码")}</span>
      {desktop && <button type="button" className="chat-code-wrap" aria-label={t("自动换行")} aria-pressed={wrapped}
        onClick={() => setWrapped(value => !value)}><WrapText size={15} /></button>}
      <ChatCopyButton text={text} label={copyLabel} /></header>
    <pre className={desktop && !wrapped ? 'chat-code-unwrapped' : undefined} tabIndex={0} onScroll={event => {
      const node = event.currentTarget;
      if (more && node.scrollHeight - node.scrollTop - node.clientHeight < 100) {
        setLimit(value => value + PAGE_CHARACTERS);
      }
    }}><code>{spans.map((span, index) => <span key={index} style={{ color: span.color && `var(--app-${syntaxColorRoles[span.color] ?? 'ink'}, ${span.color})` }}>{span.text}</span>)}</code></pre>
    {more && <button type="button" className="chat-text-action" onClick={() => setLimit(value => value + PAGE_CHARACTERS)}>
      {t("显示更多内容")}</button>}
  </section>;
}
