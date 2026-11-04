import { uiText } from "../../../../../shared/localization/uiText";
import { useEffect, useState } from "react";
import { Popover } from "antd";
import { MessageSquareQuote, X } from "lucide-react";
import { quoteKey, type ReplyQuote } from "../../../../../shared/conversation/replyQuotes";
import styles from "./ReplyQuotes.module.less";

export function ComposerQuotes({ quotes, draftKey, active, disabled, onRemove, onClear }: {
  quotes: ReplyQuote[]; draftKey: string; active: boolean; disabled: boolean;
  onRemove: (key: string) => void; onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [draftKey, active, disabled]);
  useEffect(() => { if (!quotes.length) setOpen(false); }, [quotes.length]);
  if (!quotes.length) return null;
  const content = <div className={styles.preview} onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); setOpen(false); }
  }}>
    <div className={styles.heading}>{uiText("client.composer.quotedResponse")}</div>
    <ol>{quotes.map((quote, index) => <li key={quoteKey(quote)}>
      <blockquote>{quote.text}</blockquote>
      <button type="button" disabled={disabled} className={styles.remove}
        aria-label={uiText("client.mobile.removeQuote", { value1: index + 1 })} onClick={() => onRemove(quoteKey(quote))}>
        <X size={14} aria-hidden="true" />
      </button>
    </li>)}</ol>
  </div>;
  return <div className={styles.quotes} aria-label={uiText("client.composer.quotedResponse")}>
    <span className={styles.chip}>
      <Popover trigger="click" placement="topLeft" arrow={false} content={content}
        open={open && active} onOpenChange={setOpen}
        styles={{ root: { maxWidth: 400 }, body: { padding: 0, borderRadius: 12 } }}>
        <button type="button" className={styles.previewButton} aria-label={uiText("client.composer.viewQuotes", { value1: quotes.length })}
          aria-expanded={open && active}>
          <MessageSquareQuote size={15} aria-hidden="true" />{quotes.length} {uiText("client.composer.quotes")}</button>
      </Popover>
      <button type="button" className={styles.remove} disabled={disabled} aria-label={uiText("client.composer.removeAllQuotes")} onClick={onClear}>
        <X size={14} aria-hidden="true" />
      </button>
    </span>
  </div>;
}
