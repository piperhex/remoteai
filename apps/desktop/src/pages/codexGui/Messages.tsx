import { guiText } from "../../i18n/guiText";
import type { ReactNode } from "react";
import { Spin } from "antd";
import { ArrowDown, Terminal } from "lucide-react";
import type { Conversation } from "./types";
import { lastUserMessage, type EditMessage } from "./editMessage";
import { TurnMessage } from "./TurnMessage";
import { useFollowScroll } from "./useFollowScroll";
import { useMessageWindow } from "./useMessageWindow";
import { WorkingStatus } from "./WorkingStatus";
import type { PendingRequest } from "./processing";
import { useQuoteSelection } from "./useQuoteSelection";
import { QuoteSelectionButton } from "./QuoteSelectionButton";
import { selectedQuote } from "./selectedQuote";
import type { ReplyQuote } from "./replyQuotes";
import styles from "./styles.module.less";
import { ImageThreadContext } from "./useImageSource";
import { FileThreadContext } from "./fileApi";
import { MessageEditContext } from "./messageEditContext";
import type { CapacityRetryControl } from "./CapacityErrorNotice";

export function Messages({ value, selected, active = true, footer, pendingRequest, onQuote,
  onEdit, editDisabled, editCwd, onFork, forkDisabled, retry, onCancelRetry }: {
  value?: Conversation; selected: string | null; active?: boolean; footer?: ReactNode;
  pendingRequest?: PendingRequest;
  onQuote?: (quote: ReplyQuote) => boolean;
  onEdit?: EditMessage; editDisabled?: boolean; editCwd?: string;
  onFork?: (threadId: string, turnId: string) => Promise<boolean>; forkDisabled?: boolean;
} & CapacityRetryControl) {
  const last = lastUserMessage(value);
  const { viewport, content, away, onScroll, jumpToLatest, pauseFollowing } = useFollowScroll(selected, active);
  const history = useMessageWindow({ turns: value?.turns, selected, active, viewport, pauseFollowing });
  const quote = useQuoteSelection({ root: content, selected, enabled: active && Boolean(onQuote) });
  const sending = pendingRequest && pendingRequest.threadId === selected && !value?.activeTurn;
  const processing = value?.processing;
  const activeTurn = value?.turns.find((turn) => turn.id === value.activeTurn);
  return <MessageEditContext.Provider value={{ cwd: editCwd ?? value?.thread.cwd ?? "", active }}>
    <FileThreadContext.Provider value={selected}>
    <ImageThreadContext.Provider value={selected}><div className={styles.messageArea}>
    {quote.selection && <QuoteSelectionButton selection={quote.selection} onQuote={() => {
      const current = content.current ? selectedQuote(content.current) : null;
      if (!current || !onQuote?.(current.quote)) return;
      quote.dismiss();
      jumpToLatest();
    }} />}
    <div ref={viewport} className={styles.messageViewport} aria-label={guiText("对话消息")}
      onWheel={history.onWheel} onScroll={() => {
        onScroll();
        history.onScroll();
      }}>
      <div ref={content} className={styles.messageScrollBody}>
        <div className={styles.messageContent}>
          {!selected && <div className={styles.welcome}>
            <div className={styles.welcomeIcon}><Terminal size={28} /></div>
            <h1>{guiText("想一起完成什么？")}</h1><p>{guiText("直接提问，或选择一个项目开始任务。")}</p>
            <div className={styles.suggestions}><span>{guiText("理解代码")}</span><span>{guiText("实现功能")}</span><span>{guiText("排查问题")}</span></div>
          </div>}
          {selected && !value && <div className={styles.listEmpty}><Spin /><p>{guiText("正在读取对话…")}</p></div>}
          {history.hasMore && <div className={styles.historyLoader}>
            {history.loading ? <span role="status"><Spin size="small" />{guiText("正在加载更早的消息…")}</span>
              : <button type="button" onClick={history.loadOlder}>{guiText("加载更早的消息")}</button>}
          </div>}
          {history.entries.map(({ turn, items, followsInterruption }) => <TurnMessage
            key={`${selected}:${turn.id}`} turn={turn} visibleItems={items}
            threadId={selected ?? undefined}
            retry={retry?.threadId === selected && retry.turnId === turn.id ? retry : undefined}
            onCancelRetry={onCancelRetry}
            onFork={onFork && selected ? () => { void onFork(selected, turn.id); } : undefined}
            forkDisabled={forkDisabled}
            editableItemId={last?.turnId === turn.id ? last.item.id : undefined}
            editDisabled={editDisabled || Boolean(value?.activeTurn || pendingRequest || last?.item.localEcho)}
            onEdit={onEdit && selected && last ? (content) => onEdit({ threadId: selected,
              turnId: turn.id, itemId: last.item.id, ...content }) : undefined}
            followsInterruption={followsInterruption}
            running={value?.activeTurn === turn.id} active={active} />)}
          {value?.error && <p className={styles.turnError} role="status">{value.error}</p>}
          {value?.activeTurn && <WorkingStatus key={`${selected}:${value.activeTurn}`} active={active}
            turn={activeTurn} processing={processing} />}
          {sending && <WorkingStatus key={`sending:${selected}`} active={active} pendingRequest={pendingRequest} />}
        </div>
        <div className={styles.messageFooter}>
          {away && <button type="button" className={styles.jumpToLatest} onClick={jumpToLatest}>
            <ArrowDown size={15} />{guiText("回到最新消息")}</button>}
          {footer}
        </div>
      </div>
    </div>
  </div></ImageThreadContext.Provider></FileThreadContext.Provider></MessageEditContext.Provider>;
}
