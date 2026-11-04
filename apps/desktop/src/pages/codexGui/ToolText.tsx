import { uiText } from "../../../../../shared/localization/uiText";
import { CopyButton } from "../../../../../shared/conversation/CopyButton";
import { RichText } from "../../../../../shared/conversation/RichText";
import styles from "./ActivityRow.module.less";
import { CompletePlainText } from "../../../../../shared/chat/CompletePlainText";

const COPY_ACTION_THRESHOLD = 8_000;
const MAX_FORMATTED_TOOL_CHARACTERS = 100_000;

/** The enclosing disclosure owns mounting; an open output always contains the complete text. */
export function ToolText({ text, markdown = false, className, showCopy = true }: {
  text: string; markdown?: boolean; className?: string; showCopy?: boolean;
}) {
  // Keep very large logs complete without blocking the UI on Markdown parsing.
  const formatMarkdown = markdown && text.length <= MAX_FORMATTED_TOOL_CHARACTERS;
  return <>
    <div className={styles.textViewport}
      tabIndex={0} role="region" aria-label={uiText("client.workspaceActions.toolContent")}>
      {formatMarkdown ? <RichText text={text} /> : <pre className={className}><CompletePlainText text={text} /></pre>}
    </div>
    {showCopy && text.length > COPY_ACTION_THRESHOLD && <div className={styles.outputActions}>
      <CopyButton text={text} label={uiText("client.mobile.copyFullContent")} />
    </div>}
  </>;
}
