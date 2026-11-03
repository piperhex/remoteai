import { displayText } from '../i18n/index';
import { createThemedStyles } from '../theme/styles';
import { textMetrics } from '../theme/text';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { ActivityIndicator, Pressable, SectionList, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import type { ChatProject, ChatState, Thread } from './types';
import { threadPresentation } from '../../../../shared/remote-chat/sidebar';
import { useThreadGroups } from '../../../../shared/remote-chat/client/useThreadGroups';
import { useThreadListScroll } from './useThreadListScroll';
import type { ChatController } from './controller';
import { palette, useStyles } from './styles';
import { THREAD_LONG_PRESS_MS } from '../../../../shared/remote-chat/client/threadActions';
import { useGrouping } from '../../../../shared/chat/groups/context';
import { NativeGroupIcon } from './groups/GroupChoice';

interface Props {
  state: ChatState; newChat: (project?: ChatProject) => void; select: (thread: Thread) => void;
  controller: ChatController;
  bottomInset: number;
  openActions: (thread: Thread) => void;
  openProjectActions: (project: ChatProject) => void;
}

const LIST_BOTTOM_SPACING = 16;
const MAX_INDENT_DEPTH = 6;
const LEVEL_INDENT = 12;
const GROUP_CONTENT_INDENT = 40;

export function ChatThreadList({ state, newChat, select, controller, bottomInset,
  openActions, openProjectActions }: Props) {
  const styles = useStyles();
  const listStyles = useListStyles();
  const color = useThemeColor();
  const grouping = useGrouping();
  useLanguage();
  const { groups, toggle, toggleCollapse } = useThreadGroups(state);
  const layoutKey = JSON.stringify(groups.map(group => [group.id, group.data.length, group.canToggle]));
  const pagination = useThreadListScroll(state, controller, layoutKey);
  const ready = state.ready;
  return (
    <SectionList style={styles.fill} sections={groups.map(group =>
      ({ ...group, key: group.id,
        contentIndent: Math.min(group.depth, MAX_INDENT_DEPTH) * LEVEL_INDENT
          + (group.kind === 'group' ? GROUP_CONTENT_INDENT : 0),
        label: group.kind === 'group' || group.cwd
        ? group.label : t(group.id === 'ungrouped' ? 'client.groups.ungrouped' : 'client.chat.recent') }))}
      keyExtractor={(thread) => thread.id}
      contentContainerStyle={[listStyles.content, { paddingBottom: bottomInset + LIST_BOTTOM_SPACING }]}
      stickySectionHeadersEnabled={false} keyboardShouldPersistTaps="handled"
      refreshing={Boolean(state.listRefreshing)} onRefresh={() => { void controller.list(); }}
      onLayout={pagination.onLayout} onContentSizeChange={pagination.onContentSizeChange}
      onScroll={pagination.onScroll} scrollEventThrottle={16}
      renderSectionHeader={({ section }) => <View style={[styles.row,
        { paddingLeft: Math.min(section.depth, MAX_INDENT_DEPTH) * LEVEL_INDENT }]}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: !section.collapsed }}
          accessibilityLabel={section.kind === 'group'
            ? t(section.collapsed ? 'client.groups.expand' : 'client.groups.collapse', { name: section.label })
            : `${section.collapsed ? t("client.chat.expandProject") : t("client.chat.collapseProject")}：${section.label}`}
          accessibilityHint={section.cwd ? t('client.projectActions.longPressHint') : undefined}
          delayLongPress={THREAD_LONG_PRESS_MS}
          onLongPress={section.kind === 'group' ? grouping?.openManager
            : section.cwd ? () => openProjectActions(section) : undefined}
          accessibilityActions={section.kind === 'group' || section.cwd ? [{ name: 'longpress',
            label: section.kind === 'group' ? t('client.groups.manage')
              : t('client.conversation.manageProject', { value1: section.label }) }] : undefined}
          onAccessibilityAction={event => {
            if (event.nativeEvent.actionName !== 'longpress') return;
            if (section.kind === 'group') grouping?.openManager();
            else if (section.cwd) openProjectActions(section);
          }}
          style={[listStyles.projectToggle, styles.fill]} onPress={() => toggleCollapse(section.id)}>
          <Feather name={section.collapsed ? 'chevron-right' : 'chevron-down'} size={14} color={color(palette.muted, 'muted')} />
          {section.kind === 'group' && <NativeGroupIcon icon={section.icon} size={16} />}
          <Text numberOfLines={1} style={[listStyles.project, styles.fill]}>{section.label}</Text>
          {state.sidebar.pinnedProjects?.includes(section.cwd) && <Feather name="bookmark" size={12}
            accessibilityLabel={t('client.workspaceActions.pinned')} color={color(palette.muted, 'muted')} />}
        </Pressable>
        {!!section.cwd && <Pressable accessibilityRole="button" accessibilityLabel={t("client.chat.startAChatIn", { value1: section.label })}
          disabled={state.sending} style={[listStyles.add, state.sending && styles.disabled]}
          onPress={() => newChat(section)}><Text style={listStyles.plus}>＋</Text></Pressable>}
      </View>}
      renderSectionFooter={({ section }) => section.canToggle ? <Pressable accessibilityRole="button"
        accessibilityLabel={`${section.expanded ? t("client.chat.collapse") : t("client.chat.showMore.83ad87")}：${section.label}`}
        accessibilityState={{ expanded: section.expanded }}
        style={[listStyles.more, { marginLeft: section.contentIndent }]} onPress={() => toggle(section.id)}>
        <Text style={styles.subtitle}>{section.expanded ? t("client.chat.collapse") : t("client.chat.showMore.83ad87")}</Text>
      </Pressable> : null}
      renderItem={({ item, section }) => {
        const view = threadPresentation(item, state.sidebar, displayText);
        return <Pressable accessibilityRole="button" accessibilityLabel={view.title}
          accessibilityHint={t("client.mobile.longPressToManageConversation")} delayLongPress={THREAD_LONG_PRESS_MS}
          onLongPress={() => openActions(item)}
          accessibilityActions={[{ name: 'longpress', label: t("client.threadActions.chatActions") }]}
          onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'longpress') openActions(item); }}
          accessibilityState={{ selected: state.selected?.id === item.id }}
          disabled={(!ready && !state.cachedThreadIds?.includes(item.id)) || state.sending}
          style={[listStyles.thread, { marginLeft: section.contentIndent },
            state.selected?.id === item.id && listStyles.selected]}
          onPress={() => select(item)}>
          <Text numberOfLines={1} style={listStyles.title}>{view.title}</Text>
          <View style={listStyles.status}>
            {ready && view.running ? <ActivityIndicator size="small" color={color(palette.muted, 'muted')} accessibilityLabel={t("client.chat.replying")} />
              : view.unread && <View accessible accessibilityLabel={t("client.chat.unreadReply")} style={listStyles.dot} />}
          </View>
        </Pressable>;
      }}
      ListEmptyComponent={<View style={styles.empty}><Text style={styles.subtitle}>
        {ready ? t("client.chat.noChatsYet") : t("client.chat.connectToYourComputerToViewChats")}</Text></View>}
      ListFooterComponent={state.cursor ? <View style={listStyles.pagination}>
        {pagination.loadingMore && <View style={styles.row}>
          <ActivityIndicator size="small" color={color(palette.muted, 'muted')} />
          <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.subtitle}>{t("client.projectBrowser.loading")}</Text>
        </View>}
        {pagination.failed && <Pressable accessibilityRole="button" style={styles.button}
          disabled={state.loading || !ready} onPress={pagination.retry}>
          <Text style={styles.buttonText}>{t("client.chat.couldNotLoadSelectToRetry")}</Text>
        </Pressable>}
      </View> : null} />
  );
}

const useListStyles = createThemedStyles((color) => ({
  content: { paddingHorizontal: 14 },
  pagination: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  projectToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 10 },
  project: { ...textMetrics(12, 18), color: color(palette.muted, 'muted'), fontWeight: '600' },
  add: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  plus: { color: color(palette.muted, 'muted'), fontSize: 22 },
  thread: { minHeight: 46, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center',
    gap: 10, borderRadius: 10 },
  selected: { backgroundColor: color('#e6f8f1', 'canvas') },
  title: { flex: 1, color: color(palette.ink, 'ink'), ...textMetrics(14, 22) },
  status: { width: 18, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color('#a7b1ab', 'elevated') },
  more: { paddingHorizontal: 10, minHeight: 40, justifyContent: 'center' },
}));
