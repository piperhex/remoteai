import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useChatScroll } from './useChatScroll';
import { ChatActivityRow, ChatMessage } from './ChatMessage';
import { ChatToolDetails } from './ChatToolDetails';
import { ChatWorkDrawer } from './ChatWorkDrawer';
import { ChatProcessSummary } from './ChatProcessSummary';
import { ChatTurnDuration, ChatTurnSummary, type TurnPanel } from './ChatTurnSummary';
import { ChatTurnDetails } from './ChatTurnDetails';
import { findWorkEntry } from './turnPresentation';
import { activityTimeline, findActivityEntry, latestActivity, type TimelineEntry as Entry } from './activityTimeline';
import { useConversationEntries } from './useConversationEntries';
import { currentRunningTurn } from '../../../../shared/chat/runningTurn';
import { hasCompactTimelineGap } from '../../../../shared/chat/timelineSpacing';
import { questionMessageText } from '../../../../shared/remote-chat/client/asyncQuestions';
import type { ChatMessagesProps } from '../../../../shared/remote-chat/client/messageProps';
import { palette, useStyles } from './styles';

type ProcessSelection = { type: 'work' | 'activities'; id: string };
type Selection = ProcessSelection | { type: 'item'; id: string }
  | { type: 'turn'; id: string; panel: TurnPanel };

const PROCESS_SEPARATOR_STYLE = { height: 14 };
const RESPONSE_SEPARATOR_STYLE = { height: 12 };
const RESPONSE_TEXT_SEPARATOR_STYLE = { height: 6 };
const RESPONSE_ACTIONS_SEPARATOR_STYLE = { height: 4 };

function hasReplyActions(entry: Entry) {
  if (entry.kind !== 'message' || entry.item.type !== 'agentMessage') return false;
  const running = entry.turn.status === 'inProgress' && entry.item.status !== 'completed';
  return !running && Boolean(questionMessageText(entry.item).trim());
}

function MessageSeparator({ previous, next }: { previous?: Entry; next?: Entry }) {
  const styles = useStyles();
  useLanguage();
  if (!previous) return null;
  if (next && hasCompactTimelineGap(previous, next)) {
    const processItems = [previous, next].every(entry => entry.kind === 'process' || entry.kind === 'activities');
    if (processItems) return <View style={styles.processSeparator} />;
    // The copy action already reserves a full touch target below the reply.
    if (hasReplyActions(previous)) return <View style={RESPONSE_ACTIONS_SEPARATOR_STYLE} />;
    // Text already includes its paragraph top margin; only add the remaining response spacing.
    const text = (next.kind === 'message' || next.kind === 'process') && next.item.type === 'agentMessage';
    return <View style={text ? RESPONSE_TEXT_SEPARATOR_STYLE : RESPONSE_SEPARATOR_STYLE} />;
  }
  const process = previous.kind === 'process' || previous.kind === 'activities'
    || (previous.kind === 'work' && previous.inline);
  return <View style={process ? PROCESS_SEPARATOR_STYLE : styles.messageSeparator} />;
}

const TimelineEntry = memo(function TimelineEntry({ entry, open, onInline, processing }: {
  entry: Entry; open: (selection: Selection) => void; onInline: (turnId: string, inline: boolean) => void;
  processing?: ReactNode;
}) {
  const styles = useStyles();
  useLanguage();
  const openItem = useCallback((id: string) => {
    if (entry.kind === 'process') onInline(entry.turn.id, true);
    open({ type: 'item', id });
  }, [open, onInline, entry.kind, entry.turn.id]);
  if (entry.kind === 'duration') return <ChatTurnDuration turn={entry.turn} />;
  if (entry.kind === 'summary') return <>{processing}{processing && <View style={styles.messageSeparator} />}
    <ChatTurnSummary turn={entry.turn} onOpen={(id, panel) => open({ type: 'turn', id, panel })} /></>;
  if (entry.kind === 'work') return <ChatProcessSummary entry={entry} onInline={onInline}
    onOpen={() => open({ type: 'work', id: entry.id })} />;
  if (entry.kind === 'activities') {
    const item = latestActivity(entry.items);
    return item ? <ChatActivityRow item={item} count={entry.items.length}
      running={entry.turn.status === 'inProgress'} onOpen={() => {
        onInline(entry.turn.id, true);
        open({ type: 'activities', id: entry.id });
      }} /> : null;
  }
  return <ChatMessage item={entry.item} process={entry.kind === 'process'}
    onOpen={openItem}
    running={entry.turn.status === 'inProgress' && entry.item.status !== 'completed'} />;
});

export function ChatMessages({ thread, loading, loadingMore, hasMore, loadOlder, historyLoad, offline, processing }:
  ChatMessagesProps & { processing?: ReactNode }) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const turns = useMemo(() => (thread?.turns ?? []).map((turn) => offline && turn.status === 'inProgress'
    ? { ...turn, status: 'cached' } : turn), [thread?.turns, offline]);
  const { entries, hasObservedLiveTurn, setInline } = useConversationEntries(turns);
  const timeline = useMemo(() => activityTimeline(entries), [entries]);
  const followingEntries = useMemo(() => new Map(timeline.slice(1).map((entry, index) =>
    [timeline[index].id, entry])), [timeline]);
  const separator = useCallback(({ leadingItem }: { leadingItem?: Entry }) =>
    <MessageSeparator previous={leadingItem} next={leadingItem && followingEntries.get(leadingItem.id)} />,
  [followingEntries]);
  const runningTurn = currentRunningTurn(turns);
  const runningSummary = timeline.find(entry => entry.kind === 'summary' && entry.turn.id === runningTurn?.id);
  const { list, more, preservePosition, historyBottomSpace, initializing, onItemLayout, onFooterLayout,
    showScrollToBottom, scrollToBottom, ...scrollHandlers }
    = useChatScroll<Entry>({ hasMore, loading, loadingMore, loadOlder, historyLoad, threadId: thread?.id,
      latestItemId: timeline.at(-1)?.id, bottomPadding: styles.messages.padding });
  // Expanded group headers can be replaced when an older page extends the group; anchor a message instead.
  const firstMessageIndex = entries[0]?.kind === 'work' && entries[0].inline ? 1 : 0;
  // Keep live messages visible through completion, including replies that never call tools.
  const showInitialLoading = (!hasObservedLiveTurn && initializing) || (loading && !loadingMore && !entries.length);
  const [selection, setSelection] = useState<Selection | null>(null);
  const open = useCallback((value: Selection) => { Keyboard.dismiss(); setSelection(value); }, []);
  // Resolve against live history so open process, plan, output and diff drawers keep receiving updates.
  const processSelection = selection?.type === 'work' || selection?.type === 'activities' ? selection : undefined;
  const findProcessEntry = processSelection?.type === 'work' ? findWorkEntry : findActivityEntry;
  const selectedEntry = processSelection ? findProcessEntry(entries, processSelection.id) : undefined;
  const selectedTool = selection?.type === 'item'
    ? thread?.turns?.flatMap((turn) => turn.items).find((item) => item.id === selection.id) : undefined;
  const selectedTurn = selection?.type === 'turn' ? thread?.turns?.find((turn) => turn.id === selection.id) : undefined;
  const close = () => setSelection(null);
  return <><View style={styles.fill}><FlatList ref={list} data={timeline} keyExtractor={(entry) => entry.id}
    style={showInitialLoading && styles.messageListLoading}
    pointerEvents={showInitialLoading ? 'none' : 'auto'} accessibilityElementsHidden={showInitialLoading}
    importantForAccessibility={showInitialLoading ? 'no-hide-descendants' : 'auto'}
    contentContainerStyle={entries.length || processing ? styles.messages : styles.empty}
    renderItem={({ item: entry }) => <View collapsable={false} onLayout={() => onItemLayout(entry.id)}>
      <TimelineEntry entry={entry} open={open} onInline={setInline}
        processing={entry === runningSummary ? processing : undefined} />
    </View>}
    ItemSeparatorComponent={separator}
    keyboardShouldPersistTaps="handled" initialNumToRender={10}
    // Keep message views attached while the keyboard changes the native clipping bounds.
    removeClippedSubviews={false}
    // Android's edge stretch resamples every glyph and flashes when the list springs back.
    overScrollMode="never"
    alwaysBounceVertical
    // FlatList accounts for the list header itself, including in one-message conversations.
    maintainVisibleContentPosition={preservePosition ? { minIndexForVisible: firstMessageIndex } : undefined}
    {...scrollHandlers}
    ListHeaderComponent={<View style={(hasMore || loadingMore) && [styles.historyStatus, styles.messageHeader]}>
      {(hasMore || loadingMore) && <Pressable accessibilityRole="button" onPress={more} disabled={loadingMore}
        accessibilityState={{ disabled: Boolean(loadingMore) }}>
        <Text style={styles.subtitle}>{loadingMore ? t("client.mobile.loading") : t("client.chat.loadEarlierMessages")}</Text>
      </Pressable>}
    </View>}
    ListEmptyComponent={showInitialLoading || processing ? null : <View style={styles.empty}>
      <Ionicons name="terminal-outline" size={28} color={color(palette.green, 'accent')} />
      <Text style={styles.title}>{t("client.chat.whatShallWeWorkOn")}</Text>
      <Text style={[styles.subtitle, styles.centerText]}>{t("client.chat.askAQuestionOrChooseAProjectToGetStarted")}</Text>
    </View>}
    ListFooterComponent={<View style={[styles.messageFooter, { paddingBottom: historyBottomSpace }]}
      onLayout={onFooterLayout}>{runningSummary ? null : processing}</View>} />
    {showScrollToBottom && !showInitialLoading && entries.length > 0 && <Pressable
      accessibilityRole="button" accessibilityLabel={t("client.chat.scrollToBottom")} onPress={scrollToBottom}
      style={({ pressed }) => [styles.scrollToBottom, pressed && styles.scrollToBottomPressed]}>
      <Ionicons name="arrow-down" size={18} color={color(palette.ink, 'ink')} />
      <Text style={styles.scrollToBottomText}>{t("client.chat.scrollToBottom")}</Text>
    </Pressable>}
    {showInitialLoading && <View style={styles.messageLoadingOverlay}>
      <ActivityIndicator size="small" accessibilityLabel={t("client.mobile.loadingChatHistory")} />
      <Text style={[styles.subtitle, styles.messageLoadingText]}>{t("client.chat.loadingChatHistory")}</Text>
    </View>}
    </View>
    {selectedEntry && <ChatWorkDrawer key={processSelection?.id} entry={selectedEntry} onClose={close} />}
    {selectedTool && <ChatToolDetails key={selectedTool.id} item={selectedTool} onClose={close} />}
    {selectedTurn && selection?.type === 'turn' && <ChatTurnDetails turn={selectedTurn}
      panel={selection.panel} onClose={close} />}
  </>;
}
