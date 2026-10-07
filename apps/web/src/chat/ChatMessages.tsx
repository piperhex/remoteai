import { t, useLanguage } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ChevronDown, ChevronRight, Terminal } from 'lucide-react';
import type { ChatMessagesProps } from '../../../../shared/remote-chat/client/messageProps';
import { useConversationEntries } from '../../../../shared/chat/useConversationEntries';
import { findWorkEntry, type WorkEntry } from '../../../../shared/chat/turnPresentation';
import { activityTimeline, findActivityEntry, latestActivity, type TimelineEntry as Entry }
  from '../../../../shared/chat/activityTimeline';
import { ChatActivity } from './ChatActivity';
import { turnElapsedMs } from '../../../desktop/src/pages/codexGui/turnTiming';
import { formatTurnDuration } from './formatters';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import { useDesktopLayout } from '../useDesktopLayout';
import { useHistoryScroll } from './useHistoryScroll';
import { ChatMessage } from './ChatMessage';
import { ChatToolDetails } from './ChatToolDetails';
import { ChatTurnDetails } from './ChatTurnDetails';
import { ChatTurnSummary, type TurnPanel } from './ChatTurnSummary';
import { ChatTurnTiming, desktopTimeline } from './ChatTurnTiming';
import { ChatSelectionQuote } from './ChatSelectionQuote';
import './messages.css';
import './desktopMessages.css';

type WorkSelection = { type: 'work' | 'activities'; id: string };
type Selection = WorkSelection | { type: 'item'; id: string; back?: WorkSelection }
  | { type: 'turn'; id: string; panel: TurnPanel };

function WorkSummary({ entry, open, inline, desktop }: {
  entry: WorkEntry; open: () => void; inline: (id: string, value: boolean) => void;
  desktop: boolean;
}) {
  useLanguage();
  const running = entry.turn.status === 'inProgress';
  const elapsed = entry.timed ? turnElapsedMs(entry.turn, 0) : null;
  const label = elapsed == null ? (running ? t("正在处理") : t("处理过程")) : t("用时 {value1}", { value1: formatTurnDuration(elapsed) });
  if (desktop) return <div className="chat-work-summary chat-desktop-work">
    <button type="button" aria-label={t("查看处理过程，{value1} 项活动", { value1: entry.items.length })} aria-expanded={entry.inline}
      onClick={() => inline(entry.turn.id, !entry.inline)}>
      <span>{entry.timed ? <ChatTurnTiming turn={entry.turn} fallback={t("处理过程")} /> : t("处理过程")}</span>
      <ChevronRight size={14} /></button>
  </div>;
  return <div className="chat-work-summary">
    <button type="button" aria-label={t("查看处理过程，{value1} 项活动", { value1: entry.items.length })} onClick={open}>
      <span>{label}</span><ChevronRight size={14} /></button>
    {(entry.inline || ['inProgress', 'interrupted', 'failed'].includes(entry.turn.status)) &&
      <button type="button" aria-expanded={entry.inline} aria-label={entry.inline ? t("收起处理过程") : t("展开处理过程")}
        onClick={() => inline(entry.turn.id, !entry.inline)}>
        <span>{entry.inline ? t("收起") : t("展开")}</span><ChevronDown size={14} /></button>}
  </div>;
}

function TimelineEntry({ entry, open, inline, desktop }: {
  entry: Entry; open: (selection: Selection) => void; inline: (id: string, value: boolean) => void;
  desktop: boolean;
}) {
  useLanguage();
  if (entry.kind === 'activities') {
    const item = latestActivity(entry.items);
    return item && <ChatActivity item={item} count={entry.items.length}
      running={entry.turn.status === 'inProgress' && item.status === 'inProgress'}
      inline={desktop} onInspect={() => inline(entry.turn.id, true)}
      content={desktop ? entry.items.map(activity => <ChatMessage key={activity.id} item={activity} process desktop
        running={entry.turn.status === 'inProgress' && activity.status === 'inProgress'}
        onInspect={() => inline(entry.turn.id, true)} onOpen={id => open({ type: 'item', id })} />) : undefined}
      onOpen={() => open({ type: 'activities', id: entry.id })} />;
  }
  if (entry.kind === 'duration') {
    if (desktop) return <p className="chat-turn-duration"><ChatTurnTiming turn={entry.turn} /></p>;
    const elapsed = turnElapsedMs(entry.turn, 0);
    return elapsed == null ? null : <p className="chat-turn-duration">{t("用时")} {formatTurnDuration(elapsed)}</p>;
  }
  if (entry.kind === 'summary') return <ChatTurnSummary turn={entry.turn} hideStopped={desktop}
    onOpen={panel => open({ type: 'turn', id: entry.turn.id, panel })} />;
  if (entry.kind === 'work') return <WorkSummary entry={entry} inline={inline} desktop={desktop}
    open={() => open({ type: 'work', id: entry.id })} />;
  return <ChatMessage item={entry.item} process={entry.kind === 'process'} desktop={desktop}
    onInspect={() => inline(entry.turn.id, true)}
    onOpen={id => { if (entry.kind === 'process') inline(entry.turn.id, true); open({ type: 'item', id }); }}
    running={entry.turn.status === 'inProgress' && entry.item.status !== 'completed'} />;
}

export function ChatMessages(props: ChatMessagesProps) {
  useLanguage();
  const desktop = useDesktopLayout();
  const { thread, loading, loadingMore, hasMore, offline } = props;
  const turns = useMemo(() => (thread?.turns ?? []).map(turn => offline && turn.status === 'inProgress'
    ? { ...turn, status: 'cached' } : turn), [thread?.turns, offline]);
  const { entries, setInline } = useConversationEntries(turns);
  const timeline = useMemo(() => activityTimeline(desktop ? desktopTimeline(entries) : entries), [desktop, entries]);
  const scroll = useHistoryScroll(props);
  const [selection, setSelection] = useState<Selection | null>(null);
  // Dismiss the previous layout's sheets before switching to inline work and docked reviews.
  useEffect(() => { setSelection(null); }, [desktop]);
  const work = selection?.type === 'work' ? findWorkEntry(entries, selection.id)
    : selection?.type === 'activities' ? findActivityEntry(entries, selection.id) : undefined;
  const item = selection?.type === 'item'
    ? turns.flatMap(turn => turn.items).find(item => item.id === selection.id) : undefined;
  const turn = selection?.type === 'turn' ? turns.find(turn => turn.id === selection.id) : undefined;
  const back = selection?.type === 'item' ? selection.back : undefined;
  const close = () => setSelection(null);
  return <>
    <div className="chat-message-region">
      <ChatSelectionQuote root={scroll.content} selected={thread?.id ?? null} enabled={desktop} />
      <div ref={scroll.list} className="chat-scroll chat-messages" aria-label={t("聊天记录")}
        onScroll={scroll.onScroll} onWheel={scroll.onWheel}>
        <div ref={scroll.content} className={`chat-message-content${!entries.length ? ' is-empty' : ''}`}
          onClickCapture={desktop ? scroll.pauseFollowing : undefined}>
          {(hasMore || (loading && !entries.length)) && <div className="chat-history-more">
            {loadingMore || (loading && !entries.length)
              ? <span role="status" className="chat-processing"><span className="chat-spinner" />{t("正在加载聊天记录…")}</span>
              : <button type="button" className="chat-text-action" onClick={scroll.more}>{t("加载更早的消息")}</button>}
          </div>}
          {timeline.map(entry => <div key={entry.id}
            data-message-id={'item' in entry ? entry.item.id : entry.id} className={`chat-entry-${entry.kind}`}>
            <TimelineEntry entry={entry} open={setSelection} inline={setInline} desktop={desktop} />
          </div>)}
          {!entries.length && !loading && <div className="chat-empty"><Terminal size={28} className="chat-empty-glyph" />
            <h2>{t("想一起完成什么？")}</h2><p className="chat-muted">{t("直接提问，或选择一个项目开始任务。")}</p>
            {desktop && <div className="chat-empty-suggestions"><span>{t("理解代码")}</span><span>{t("实现功能")}</span>
              <span>{t("排查问题")}</span></div>}</div>}
        </div>
      </div>
      {scroll.showBottom && entries.length > 0 && <button type="button" className="chat-scroll-bottom"
        onClick={scroll.toBottom}><ArrowDown size={17} />{t("回到底部")}</button>}
    </div>
    {work && <AdaptiveSheet open title={work.turn.status === 'inProgress' ? t("正在处理") : t("处理过程")}
      subtitle={t("{value1} 项活动", { value1: work.items.length })} width={760} onClose={close}>
      <div className="chat-detail-stack">{work.items.map(item => <ChatMessage key={item.id} item={item} process
        running={work.turn.status === 'inProgress' && item.status !== 'completed'} onQuote={close}
        onOpen={id => setSelection({ type: 'item', id,
          back: { type: work.kind === 'activities' ? 'activities' : 'work', id: work.id } })} />)}</div>
    </AdaptiveSheet>}
    {item && <ChatToolDetails item={item} onClose={close}
      onBack={back ? () => setSelection(back) : undefined} />}
    {turn && selection?.type === 'turn' && <ChatTurnDetails turn={turn} panel={selection.panel} onClose={close} />}
  </>;
}
