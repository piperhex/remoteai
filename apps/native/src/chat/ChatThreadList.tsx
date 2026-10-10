import { createThemedStyles } from '../theme/styles';
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

interface Props {
  state: ChatState; newChat: (project?: ChatProject) => void; select: (thread: Thread) => void;
  controller: ChatController;
  bottomInset: number;
  openActions: (thread: Thread) => void;
}

const LIST_BOTTOM_SPACING = 16;

export function ChatThreadList({ state, newChat, select, controller, bottomInset, openActions }: Props) {
  const styles = useStyles();
  const listStyles = useListStyles();
  const color = useThemeColor();
  useLanguage();
  const { groups, toggle, toggleCollapse } = useThreadGroups(state);
  const layoutKey = JSON.stringify(groups.map(group => [group.cwd, group.data.length, group.canToggle]));
  const pagination = useThreadListScroll(state, controller, layoutKey);
  const ready = state.ready;
  return (
    <SectionList style={styles.fill} sections={groups.map(group =>
      ({ ...group, label: group.cwd ? group.label : t('最近') }))} keyExtractor={(thread) => thread.id}
      contentContainerStyle={[listStyles.content, { paddingBottom: bottomInset + LIST_BOTTOM_SPACING }]}
      stickySectionHeadersEnabled={false} keyboardShouldPersistTaps="handled"
      refreshing={Boolean(state.listRefreshing)} onRefresh={() => { void controller.list(); }}
      onLayout={pagination.onLayout} onContentSizeChange={pagination.onContentSizeChange}
      onScroll={pagination.onScroll} scrollEventThrottle={16}
      renderSectionHeader={({ section }) => <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: !section.collapsed }}
          accessibilityLabel={`${section.collapsed ? t("展开项目") : t("折叠项目")}：${section.label}`}
          style={[listStyles.projectToggle, styles.fill]} onPress={() => toggleCollapse(section.cwd)}>
          <Feather name={section.collapsed ? 'chevron-right' : 'chevron-down'} size={14} color={color(palette.muted, 'muted')} />
          <Text numberOfLines={1} style={[listStyles.project, styles.fill]}>{section.label}</Text>
        </Pressable>
        {!!section.cwd && <Pressable accessibilityRole="button" accessibilityLabel={t("在 {value1} 中新建对话", { value1: section.label })}
          disabled={state.sending} style={[listStyles.add, state.sending && styles.disabled]}
          onPress={() => newChat(section)}><Text style={listStyles.plus}>＋</Text></Pressable>}
      </View>}
      renderSectionFooter={({ section }) => section.canToggle ? <Pressable accessibilityRole="button"
        accessibilityLabel={`${section.expanded ? t("收起") : t("展开显示")}：${section.label}`}
        accessibilityState={{ expanded: section.expanded }} style={listStyles.more} onPress={() => toggle(section.cwd)}>
        <Text style={styles.subtitle}>{section.expanded ? t("收起") : t("展开显示")}</Text>
      </Pressable> : null}
      renderItem={({ item }) => {
        const view = threadPresentation(item, state.sidebar, t);
        return <Pressable accessibilityRole="button" accessibilityLabel={view.title}
          accessibilityHint={t("长按管理对话")} delayLongPress={THREAD_LONG_PRESS_MS}
          onLongPress={() => openActions(item)}
          accessibilityActions={[{ name: 'longpress', label: t("对话操作") }]}
          onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'longpress') openActions(item); }}
          accessibilityState={{ selected: state.selected?.id === item.id }}
          disabled={(!ready && !state.cachedThreadIds?.includes(item.id)) || state.sending}
          style={[listStyles.thread, state.selected?.id === item.id && listStyles.selected]}
          onPress={() => select(item)}>
          <Text numberOfLines={1} style={listStyles.title}>{view.title}</Text>
          <View style={listStyles.status}>
            {ready && view.running ? <ActivityIndicator size="small" color={color(palette.muted, 'muted')} accessibilityLabel={t("正在回复")} />
              : view.unread && <View accessible accessibilityLabel={t("未读回复")} style={listStyles.dot} />}
          </View>
        </Pressable>;
      }}
      ListEmptyComponent={<View style={styles.empty}><Text style={styles.subtitle}>
        {ready ? t("暂时没有聊天") : t("连接电脑后查看聊天")}</Text></View>}
      ListFooterComponent={state.cursor ? <View style={listStyles.pagination}>
        {pagination.loadingMore && <View style={styles.row}>
          <ActivityIndicator size="small" color={color(palette.muted, 'muted')} />
          <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.subtitle}>{t("正在加载…")}</Text>
        </View>}
        {pagination.failed && <Pressable accessibilityRole="button" style={styles.button}
          disabled={state.loading || !ready} onPress={pagination.retry}>
          <Text style={styles.buttonText}>{t("加载失败，点击重试")}</Text>
        </Pressable>}
      </View> : null} />
  );
}

const useListStyles = createThemedStyles((color) => ({
  content: { paddingHorizontal: 14 },
  pagination: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  projectToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 10 },
  project: { color: color(palette.muted, 'muted'), fontSize: 12, lineHeight: 18, fontWeight: '600' },
  add: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  plus: { color: color(palette.muted, 'muted'), fontSize: 22 },
  thread: { minHeight: 46, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center',
    gap: 10, borderRadius: 10 },
  selected: { backgroundColor: color('#e6f8f1', 'canvas') },
  title: { flex: 1, color: color(palette.ink, 'ink'), fontSize: 14, lineHeight: 22 },
  status: { width: 18, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color('#a7b1ab', 'elevated') },
  more: { paddingHorizontal: 10, minHeight: 40, justifyContent: 'center' },
}));
