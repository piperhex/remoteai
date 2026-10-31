import { t, useLanguage } from '../i18n';
import { ViewportContent } from '../../../../shared/chat/ViewportContent';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ChevronDown, ChevronRight, Terminal } from 'lucide-react';
import type { ChatMessagesProps } from '../../../../shared/remote-chat/client/messageProps';
import { useConversationEntries } from '../../../../shared/chat/useConversationEntries';
import { currentRunningTurn } from '../../../../shared/chat/runningTurn';
import { findWorkEntry, type WorkEntry } from '../../../../shared/chat/turnPresentation';
import { activityTimeline, findActivityEntry, latestActivity, type TimelineEntry as Entry }
  from '../../../../shared/chat/activityTimeline';
import { hasCompactTimelineGap } from '../../../../shared/chat/timelineSpacing';
import { ChatActivity } from './ChatActivity';
import { turnElapsedMs } from '../../../desktop/src/pages/codexGui/turnTiming';
import { formatTurnDuration } from './formatters';
import { ChatWorkDrawer } from './ChatWorkDrawer';
import { useDesktopLayout } from '../useDesktopLayout';
import { useHistoryScroll } from './useHistoryScroll';
import { ChatMessage } from './ChatMessage';
import { ChatToolDetails } from './ChatToolDetails';
import { ChatTurnDetails } from './ChatTurnDetails';
import { ChatTurnSummary } from './ChatTurnSummary';
import { useHistoryDrawers, type HistorySelection as Selection } from './useHistoryDrawers';
import { ChatTurnTiming, desktopTimeline } from './ChatTurnTiming';
import { ChatSelectionQuote } from './ChatSelectionQuote';
import './messages.css';
import './desktopMessages.css';
import type { Item, Turn } from './types';

export type RenderUserMessage = (props: { item: Item; turn: Turn }) => ReactNode;

function WorkSummary({ entry, open, inline, desktop }: {
  entry: WorkEntry; open: () => void; inline: (id: string, value: boolean) => void;
  desktop: boolean;
}) {
  useLanguage();
  const running = entry.turn.status === 'inProgress';
  const elapsed = entry.timed ? turnElapsedMs(entry.turn, 0) : null;
  const label = elapsed == null ? (running ? t("client.chat.working") : t("client.chat.activity")) : t("client.chat.duration", { value1: formatTurnDuration(elapsed) });
  if (desktop) return <div className="chat-work-summary chat-desktop-work">
    <button type="button" aria-label={t("client.chat.viewActivityActions", { value1: entry.items.length })} aria-expanded={entry.inline}
      onClick={() => inline(entry.turn.id, !entry.inline)}>
      <span>{entry.timed ? <ChatTurnTiming turn={entry.turn} fallback={t("client.chat.activity")} /> : t("client.chat.activity")}</span>
      <ChevronRight size={14} /></button>
  </div>;
  return <div className="chat-work-summary">
    <button type="button" aria-label={t("client.chat.viewActivityActions", { value1: entry.items.length })} onClick={open}>
      <span>{label}</span><ChevronRight size={14} /></button>
    {(entry.inline || ['inProgress', 'interrupted', 'failed'].includes(entry.turn.status)) &&
      <button type="button" aria-expanded={entry.inline} aria-label={entry.inline ? t("client.chat.collapseActivity") : t("client.chat.expandActivity")}
        onClick={() => inline(entry.turn.id, !entry.inline)}>
        <span>{entry.inline ? t("client.chat.collapse") : t("client.chat.expand")}</span><ChevronDown size={14} /></button>}
  </div>;
}

function TimelineEntry({ entry, open, inline, desktop, renderUserMessage }: {
  entry: Entry; open: (selection: Selection) => void; inline: (id: string, value: boolean) => void;
  desktop: boolean;
  renderUserMessage?: RenderUserMessage;
}) {
  useLanguage();
  if (entry.kind === 'activities') {
    const item = latestActivity(entry.items);
    return item && <ChatActivity item={item} count={entry.items.length}
      running={entry.turn.status === 'inProgress' && item.status === 'inProgress'}
      inline={desktop} onInspect={() => inline(entry.turn.id, true)}
      content={desktop ? () => entry.items.map(activity => <ChatMessage key={activity.id} item={activity} process desktop
        running={entry.turn.status === 'inProgress' && activity.status === 'inProgress'}
        onInspect={() => inline(entry.turn.id, true)} onOpen={id => open({ type: 'item', id })} />) : undefined}
      onOpen={() => open({ type: 'activities', id: entry.id })} />;
  }
  if (entry.kind === 'duration') {
    if (desktop) return <p className="chat-turn-duration"><ChatTurnTiming turn={entry.turn} /></p>;
    const elapsed = turnElapsedMs(entry.turn, 0);
    return elapsed == null ? null : <p className="chat-turn-duration">{t("client.chat.duration.8d6d31")} {formatTurnDuration(elapsed)}</p>;
  }
  if (entry.kind === 'summary') return <ChatTurnSummary turn={entry.turn} hideStopped={desktop}
    onOpen={panel => open({ type: 'turn', id: entry.turn.id, panel })} />;
  if (entry.kind === 'work') return <WorkSummary entry={entry} inline={inline} desktop={desktop}
    open={() => open({ type: 'work', id: entry.id })} />;
  if (entry.item.type === 'userMessage' && renderUserMessage) {
    return renderUserMessage({ item: entry.item, turn: entry.turn });
  }
  return <ChatMessage item={entry.item} process={entry.kind === 'process'} desktop={desktop}
    onInspect={() => inline(entry.turn.id, true)}
    onOpen={id => { if (entry.kind === 'process') inline(entry.turn.id, true); open({ type: 'item', id }); }}
    running={entry.turn.status === 'inProgress' && entry.item.status !== 'completed'} />;
}

type MessageProps = ChatMessagesProps & {
  processing?: ReactNode; renderUserMessage?: RenderUserMessage;
};

export function ChatMessages(props: MessageProps & { footer?: ReactNode }) {
  useLanguage();
  const desktop = useDesktopLayout();
  const scroll = useHistoryScroll(props);
  const jump = scroll.showBottom && <button type="button" className="chat-scroll-bottom"
    onClick={scroll.toBottom}><ArrowDown size={17} />{t("client.chat.scrollToBottom")}</button>;
  return <div className={`chat-message-region${props.footer ? ' has-scroll-footer' : ''}`}>
    <ChatSelectionQuote root={scroll.content} selected={props.thread?.id ?? null} enabled={desktop} />
    <div ref={scroll.list} className="chat-scroll chat-messages" aria-label={t("client.chat.chatHistory")}
      onScroll={scroll.onScroll} onWheel={scroll.onWheel}
      onTouchStart={scroll.onTouchStart} onTouchMove={scroll.onTouchMove}
      onTouchEnd={scroll.onTouchEnd} onTouchCancel={scroll.onTouchCancel}>
      <div ref={scroll.body} className="chat-message-scroll-body">
        {/* Reset history details on selection changes without remounting the composer during its first send. */}
        <ChatMessageHistory key={props.thread?.id ?? 'new'} props={props} scroll={scroll} />
        {props.footer && <div className="chat-message-footer">{jump}{props.footer}</div>}
      </div>
    </div>
    {!props.footer && jump}
  </div>;
}

function ChatMessageHistory({ props, scroll }: {
  props: MessageProps; scroll: ReturnType<typeof useHistoryScroll>;
}) {
  useLanguage();
  const desktop = useDesktopLayout();
  const { thread, loading, loadingMore, hasMore, offline } = props;
  const turns = useMemo(() => (thread?.turns ?? []).map(turn => offline && turn.status === 'inProgress'
    ? { ...turn, status: 'cached' } : turn), [thread?.turns, offline]);
  const { entries, setInline } = useConversationEntries(turns);
  const timeline = useMemo(() => activityTimeline(desktop ? desktopTimeline(entries) : entries), [desktop, entries]);
  const runningTurn = currentRunningTurn(turns);
  const runningSummary = timeline.find(entry => entry.kind === 'summary' && entry.turn.id === runningTurn?.id);
  const [selection, setSelection] = useState<Selection | null>(null);
  const drawers = useHistoryDrawers(turns);
  const open = (next: Selection) => { setSelection(drawers.open(next) ? null : next); };
  // Dismiss the previous layout's sheets before switching to inline work and docked reviews.
  useEffect(() => { setSelection(null); }, [desktop]);
  const work = selection?.type === 'work' ? findWorkEntry(entries, selection.id)
    : selection?.type === 'activities' ? findActivityEntry(entries, selection.id) : undefined;
  const item = selection?.type === 'item'
    ? turns.flatMap(turn => turn.items).find(item => item.id === selection.id) : undefined;
  const turn = selection?.type === 'turn' ? turns.find(turn => turn.id === selection.id) : undefined;
  const close = () => setSelection(null);
  return <>
    <div ref={scroll.content} className={`chat-message-content${!entries.length ? ' is-empty' : ''}`}
      onClickCapture={desktop ? scroll.pauseFollowing : undefined}>
      {(hasMore || loadingMore || (loading && !entries.length)) && <div className="chat-history-more">
        {loading && !entries.length && !loadingMore
          ? <span role="status" className="chat-processing"><span className="chat-spinner" />{t("client.chat.loadingChatHistory")}</span>
          : <button type="button" className="chat-text-action" onClick={scroll.more}
            disabled={loadingMore}>{loadingMore ? t("client.mobile.loading") : t("client.chat.loadEarlierMessages")}</button>}
      </div>}
      {timeline.map((entry, index) => <Fragment key={entry.id}>
        {entry === runningSummary && props.processing}
        <div data-message-id={'item' in entry ? entry.item.id : entry.id}
          data-message-role={'item' in entry ? entry.item.type : undefined}
          data-response-continuation={hasCompactTimelineGap(timeline[index - 1], entry) || undefined}
          className={`chat-entry-${entry.kind}`}>
          <ViewportContent enabled={desktop && 'item' in entry
            && ['userMessage', 'agentMessage'].includes(entry.item.type)}>
            {() => <TimelineEntry entry={entry} open={open} inline={setInline} desktop={desktop}
              renderUserMessage={props.renderUserMessage} />}
          </ViewportContent>
        </div>
      </Fragment>)}
      {!runningSummary && props.processing}
      {!entries.length && !loading && !props.processing && <div className="chat-empty">
        <Terminal size={28} className="chat-empty-glyph" />
        <h2>{t("client.chat.whatShallWeWorkOn")}</h2><p className="chat-muted">{t("client.chat.askAQuestionOrChooseAProjectToGetStarted")}</p>
        {desktop && <div className="chat-empty-suggestions"><span>{t("client.chat.understandCode")}</span><span>{t("client.chat.buildAFeature")}</span>
          <span>{t("client.chat.troubleshoot")}</span></div>}</div>}
    </div>
    {work && <ChatWorkDrawer key={selection?.id} entry={work} onClose={close} />}
    {item && <ChatToolDetails item={item} onClose={close} />}
    {turn && selection?.type === 'turn' && <ChatTurnDetails turn={turn} panel={selection.panel} onClose={close} />}
    {drawers.panels}
  </>;
}
