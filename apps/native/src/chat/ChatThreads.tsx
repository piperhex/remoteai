import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { textMetrics } from '../theme/text';
import { t, useLanguage } from '../i18n';
import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import type { ChatController } from './controller';
import type { ChatProject, ChatState, Thread } from './types';
import { ChatThreadList } from './ChatThreadList';
import { ChatThreadActions } from './ChatThreadActions';
import { ChatProjectActions } from './ChatProjectActions';
import { useProjectActions } from '../../../../shared/remote-chat/client/useProjectActions';
import { useThreadActions } from '../../../../shared/remote-chat/client/useThreadActions';
import { palette, useStyles } from './styles';
import { NativeGroups } from './groups/NativeGroups';
import { useGrouping } from '../../../../shared/chat/groups/context';

interface Props {
  state: ChatState; controller: ChatController; newChat: (project?: ChatProject) => void;
  openSearch: () => void; select: (thread: Thread) => void; profileMenu: ReactNode;
  active?: boolean;
}

export function ChatThreads(props: Props) {
  useLanguage();
  return <NativeGroups active={props.active ?? true} grouping={props.state.sidebar.grouping} client={props.controller.groups}
    translate={t} ready={props.state.ready}><ChatThreadsContent {...props} /></NativeGroups>;
}

function ChatThreadsContent({ state, controller, newChat, openSearch, select, profileMenu, active = true }: Props) {
  const styles = useStyles();
  const listStyles = useListStyles();
  const color = useThemeColor();
  const grouping = useGrouping();
  useLanguage();
  const [footerHeight, setFooterHeight] = useState(0);
  const actions = useThreadActions(state, controller);
  const projectActions = useProjectActions(state, controller);
  return <View style={styles.fill}>
    <View style={listStyles.header}>
      <Text style={listStyles.heading}>{t("client.app.chat")}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t('client.groups.manage')}
        style={listStyles.search} onPress={grouping?.openManager}>
        <Feather name="layers" size={21} color={color(palette.ink, 'ink')} /></Pressable>
      <Pressable accessibilityRole="button" style={listStyles.filter} disabled={state.loading}
        onPress={() => { void controller.list({ archived: !state.archived }); }}>
        <Text style={listStyles.filterText}>
          {state.archived ? t("client.chat.archived") : t("client.chat.recentChats")}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t("client.chat.searchChats")} onPress={openSearch}
        style={listStyles.search}><Feather name="search" size={23} color={color(palette.ink, 'ink')} /></Pressable>
    </View>
    <ChatThreadList state={state} controller={controller} newChat={newChat} select={select}
      openActions={actions.open} openProjectActions={projectActions.open} bottomInset={footerHeight} />
    {active && <ChatThreadActions actions={actions} />}
    {active && <ChatProjectActions actions={projectActions} />}
    <View style={listStyles.footer} pointerEvents="box-none"
      onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("client.chat.newChat")} disabled={state.sending}
        style={[listStyles.newChat, state.sending && styles.disabled]} onPress={() => newChat()}>
        <Feather name="edit" size={21} color="#fff" /><Text style={listStyles.newChatText}>{t("client.chat.newChat")}</Text>
      </Pressable>
      {profileMenu}
    </View>
  </View>;
}

const useListStyles = createThemedStyles((color) => ({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 4 },
  heading: { ...textMetrics(27, 36), color: color(palette.ink, 'ink'), fontWeight: '800', flexShrink: 0 },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  search: { width: 48, height: 48, flexShrink: 0, borderRadius: 24,
    backgroundColor: color(palette.background, 'canvas'),
    alignItems: 'center', justifyContent: 'center' },
  filter: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' },
  filterText: { ...textMetrics(13, 20), color: color(palette.muted, 'muted'), flexShrink: 1 },
  newChat: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    minHeight: 52, paddingHorizontal: 24, borderRadius: 26, backgroundColor: palette.green },
  newChatText: { color: '#fff', fontSize: 16, fontWeight: '600' },
}));
