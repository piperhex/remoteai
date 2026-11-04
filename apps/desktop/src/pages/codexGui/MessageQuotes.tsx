import { uiText } from "../../../../../shared/localization/uiText";
import { useState } from "react";
import { Popover } from "antd";
import { MessageSquareQuote } from "lucide-react";
import styles from "./ReplyQuotes.module.less";

export function MessageQuotes({ quotes }: { quotes: string[] }) {
  const [open, setOpen] = useState(false);
  if (!quotes.length) return null;
  const content = <div className={styles.preview} onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); setOpen(false); }
  }}>
    <div className={styles.heading}>{uiText("client.conversation.quotedContent")}</div>
    <ol>{quotes.map((quote, index) => <li key={index}><blockquote>{quote}</blockquote></li>)}</ol>
  </div>;
  return <div className={styles.messageQuotes}>
    <span className={styles.chip}>
      <Popover trigger="click" placement="topLeft" arrow={false} content={content}
        open={open} onOpenChange={setOpen}
        styles={{ root: { maxWidth: 400 }, body: { padding: 0, borderRadius: 12 } }}>
        <button type="button" className={styles.previewButton} aria-label={uiText("client.composer.viewQuotes", { value1: quotes.length })}
          aria-expanded={open} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
          <MessageSquareQuote size={15} aria-hidden="true" />{quotes.length} {uiText("client.composer.quotes")}</button>
      </Popover>
    </span>
  </div>;
}
