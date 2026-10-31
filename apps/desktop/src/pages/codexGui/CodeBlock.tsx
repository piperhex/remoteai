import { uiText } from "../../i18n/uiText";
import { Children, isValidElement, useState, type ReactNode } from "react";
import { CopyButton } from "./CopyButton";
import styles from "./CodeBlock.module.less";
import { HighlightedCode } from "./CodeHighlight";
import { Code2, WrapText } from "lucide-react";
import { MermaidDiagram } from "../../../../../shared/chat/MermaidDiagram";

const LANGUAGE_LABELS: Record<string, string> = {
  typescript: "TypeScript", ts: "TypeScript", javascript: "JavaScript", js: "JavaScript",
  tsx: "TSX", jsx: "JSX", json: "JSON", html: "HTML", css: "CSS", sql: "SQL", python: "Python",
  rust: "Rust", powershell: "PowerShell", bash: "Bash", shell: "Shell", get text() { return uiText("client.chat.text"); }, get plaintext() { return uiText("client.chat.text"); },
  diff: "Diff", patch: "Diff",
};

export function CodeBlock({ children }: { children?: ReactNode }) {
  const [wrapped, setWrapped] = useState(false);
  const child = Children.toArray(children).find(isValidElement);
  const props = child?.props as { className?: string; children?: ReactNode } | undefined;
  const text = typeof props?.children === "string" ? props.children : "";
  const language = props?.className?.match(/language-([\w+-]+)/)?.[1] ?? "";
  if (language.toLowerCase() === "mermaid") {
    return <MermaidDiagram source={text.replace(/\n$/, "")} previewLabel={uiText("client.chat.preview")}
      sourceLabel={uiText("client.chat.source")} copyLabel={uiText("client.chat.copySource")} />;
  }
  return <div className={styles.block}>
    <div className={styles.toolbar} data-quote-exclude>
      <span><Code2 size={16} aria-hidden="true" />{LANGUAGE_LABELS[language] ?? (language || uiText("client.chat.code"))}</span>
      <button type="button" aria-label={uiText("client.projectBrowser.wrapLines")} aria-pressed={wrapped} onClick={() => setWrapped(!wrapped)}>
        <WrapText size={15} aria-hidden="true" /></button>
      <CopyButton text={text.replace(/\n$/, "")} label={uiText("client.chat.copyCode")} />
    </div>
    <pre className={wrapped ? styles.wrapped : undefined}>
      <HighlightedCode text={text} language={language} />
    </pre>
  </div>;
}
