import { uiText } from "../../../../../shared/localization/uiText";
import { createPortal } from "react-dom";
import { MessageSquareQuote } from "lucide-react";
import type { SelectedQuote } from "../../../../../shared/conversation/selectedQuote";
import styles from "./ReplyQuotes.module.less";

export function QuoteSelectionButton({ selection, onQuote }: { selection: SelectedQuote; onQuote: () => void }) {
  return createPortal(<button type="button" className={styles.selectionButton}
    style={{ left: selection.left, top: selection.top }} onMouseDown={(event) => event.preventDefault()}
    onClick={onQuote} aria-label={uiText("client.chat.quoteSelectedTextAndReply")}>
    <MessageSquareQuote size={15} aria-hidden="true" />{uiText("client.chat.quoteReply")}</button>, document.body);
}
