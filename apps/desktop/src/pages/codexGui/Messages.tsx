import { uiText } from "../../../../../shared/localization/uiText";
import { remoteErrorText } from "../../../../../shared/localization/errors";
import { useMemo, type ReactNode } from "react";
import { Spin } from "antd";
import { ArrowDown, Terminal } from "lucide-react";
import type { Conversation, Turn } from "../../../../../shared/conversation/types";
import { lastUserMessage, type EditMessage, type DeleteMessage } from "../../../../../shared/conversation/editMessage";
import { TurnMessage } from "./TurnMessage";
import { useFollowScroll } from "./useFollowScroll";
import { useMessageWindow } from "./useMessageWindow";
import { WorkingStatus } from "./WorkingStatus";
import type { PendingRequest } from "../../../../../shared/conversation/processing";
import { useQuoteSelection } from "../../../../../shared/conversation/useQuoteSelection";
import { QuoteSelectionButton } from "./QuoteSelectionButton";
import { selectedQuote } from "../../../../../shared/conversation/selectedQuote";
import type { ReplyQuote } from "../../../../../shared/conversation/replyQuotes";
import styles from "../../../../../shared/conversation/styles.module.less";
import { ImageThreadContext } from "../../../../../shared/conversation/useImageSource";
import { FileThreadContext } from "../../../../../shared/conversation/fileApi";
import { MessageEditContext } from "./messageEditContext";
import type { CapacityRetryControl } from "../../../../../shared/conversation/CapacityErrorNotice";
import { groupVisibleTurns } from "./messageErrorGroups";
import { ConversationImageGallery } from '../../../../../shared/chat/ImageGallery';

const EMPTY_TURNS: Turn[] = [];

export function Messages({ value, selected, active = true, footer, pendingRequest, onQuote,
  onEdit, onDelete, editDisabled, editCwd, onFork, forkDisabled, retry, onCancelRetry, onLoadOlder }: {
  value?: Conversation; selected: string | null; active?: boolean; footer?: ReactNode;
  pendingRequest?: PendingRequest;
  onQuote?: (quote: ReplyQuote) => boolean;
  onEdit?: EditMessage; editDisabled?: boolean; editCwd?: string;
  onDelete?: DeleteMessage;
  onLoadOlder?: () => Promise<Turn[] | undefined>;
  onFork?: (threadId: string, turnId: string) => Promise<boolean>; forkDisabled?: boolean;
} & CapacityRetryControl) {
  const last = lastUserMessage(value);
  const { viewport, content, movement, away, showJumpToLatest, onScroll, jumpToLatest, pauseFollowing }
    = useFollowScroll(selected, active);
  const history = useMessageWindow({ turns: value?.turns, selected, active, viewport, movement, pauseFollowing, away,
    hasEarlier: value?.historyPage?.hasMore, loadEarlier: onLoadOlder });
  const entries = useMemo(() => groupVisibleTurns(history.entries), [history.entries]);
  const quote = useQuoteSelection({ root: content, selected, enabled: active && Boolean(onQuote) });
  const sending = pendingRequest && pendingRequest.threadId === selected && !value?.activeTurn;
  const processing = value?.processing;
  const activeTurn = value?.turns.find((turn) => turn.id === value.activeTurn);
  return <MessageEditContext.Provider value={{ cwd: editCwd ?? value?.thread.cwd ?? "", active }}>
    <FileThreadContext.Provider value={selected}>
    <ImageThreadContext.Provider value={selected}>
    <ConversationImageGallery turns={value?.turns ?? EMPTY_TURNS}>
    <div className={styles.messageArea}>
    {quote.selection && <QuoteSelectionButton selection={quote.selection} onQuote={() => {
      const current = content.current ? selectedQuote(content.current) : null;
      if (!current || !onQuote?.(current.quote)) return;
      quote.dismiss();
      jumpToLatest();
    }} />}
    <div ref={viewport} className={styles.messageViewport} aria-label={uiText("client.conversation.conversationMessages")}
      data-history-newer={history.hasNewer || undefined}
      onWheel={history.onWheel} onScroll={() => {
        const offsetChange = history.onScroll();
        if (history.hasNewer) pauseFollowing();
        else onScroll(offsetChange);
      }}>
      <div ref={content} className={styles.messageScrollBody}>
        <div className={styles.messageContent}>
          {!selected && <div className={styles.welcome}>
            <div className={styles.welcomeIcon}><Terminal size={28} /></div>
            <h1>{uiText("client.chat.whatShallWeWorkOn")}</h1><p>{uiText("client.chat.askAQuestionOrChooseAProjectToGetStarted")}</p>
            <div className={styles.suggestions}><span>{uiText("client.chat.understandCode")}</span><span>{uiText("client.chat.buildAFeature")}</span><span>{uiText("client.chat.troubleshoot")}</span></div>
          </div>}
          {selected && !value && <div className={styles.listEmpty}><Spin /><p>{uiText("client.conversation.loadingConversation")}</p></div>}
          {history.hasMore && <div className={styles.historyLoader}>
            {history.loading ? <span role="status"><Spin size="small" />{uiText("client.conversation.loadingEarlierMessages")}</span>
              : <button type="button" onClick={history.loadOlder}>{uiText("client.chat.loadEarlierMessages")}</button>}
          </div>}
          {entries.map(({ turn, items, followsInterruption, groups }) => <TurnMessage
            key={`${selected}:${turn.id}`} turn={turn} visibleItems={items}
            messageGroups={groups}
            threadId={selected ?? undefined}
            retry={retry?.threadId === selected && retry.turnId === turn.id ? retry : undefined}
            onCancelRetry={onCancelRetry}
            onFork={onFork && selected ? () => { void onFork(selected, turn.id); } : undefined}
            forkDisabled={forkDisabled}
            editableItemId={last?.turnId === turn.id ? last.item.id : undefined}
            editDisabled={editDisabled || Boolean(value?.activeTurn || pendingRequest || last?.item.localEcho)}
            onEdit={onEdit && selected && last ? (content) => onEdit({ threadId: selected,
              turnId: turn.id, itemId: last.item.id, ...content }) : undefined}
            onDelete={onDelete && selected && last ? () => onDelete({ threadId: selected,
              turnId: turn.id, itemId: last.item.id }) : undefined}
            followsInterruption={followsInterruption}
            running={value?.activeTurn === turn.id} active={active} />)}
          {history.hasNewer && <div className={styles.historyLoader}>
            <button type="button" onClick={history.loadNewer} disabled={history.loading}>
              {uiText("client.chat.loadNewerMessages")}</button>
          </div>}
          {value?.error && <p className={styles.turnError} role="status">{remoteErrorText(value.error)}</p>}
          {value?.activeTurn && <WorkingStatus key={`${selected}:${value.activeTurn}`} active={active}
            turn={activeTurn} processing={processing} />}
          {sending && <WorkingStatus key={`sending:${selected}`} active={active} pendingRequest={pendingRequest} />}
        </div>
        <div className={styles.messageFooter}>
          {showJumpToLatest && <button type="button" className={styles.jumpToLatest} onClick={jumpToLatest}>
            <ArrowDown size={15} />{uiText("client.conversation.jumpToLatestMessage")}</button>}
          {footer}
        </div>
      </div>
    </div>
  </div></ConversationImageGallery>
  </ImageThreadContext.Provider></FileThreadContext.Provider></MessageEditContext.Provider>;
}
