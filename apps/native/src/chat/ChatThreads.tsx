import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import type { ChatController } from './controller';
import type { ChatProject, ChatState, Thread } from './types';
import { ChatThreadList } from './ChatThreadList';
import { ChatThreadActions } from './ChatThreadActions';
import { useThreadActions } from '../../../../shared/remote-chat/client/useThreadActions';
import { palette, useStyles } from './styles';

interface Props {
  state: ChatState; controller: ChatController; newChat: (project?: ChatProject) => void;
  openSearch: () => void; select: (thread: Thread) => void; profileMenu: ReactNode;
}

export function ChatThreads({ state, controller, newChat, openSearch, select, profileMenu }: Props) {
  const styles = useStyles();
  const listStyles = useListStyles();
  const color = useThemeColor();
  useLanguage();
  const [footerHeight, setFooterHeight] = useState(0);
  const actions = useThreadActions(state, controller);
  return <View style={styles.fill}>
    <View style={styles.padded}>
      <View style={styles.row}>
        <Text style={[styles.heading, styles.fill]}>{t("聊天")}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("搜索聊天")} onPress={openSearch}
          style={listStyles.search}><Feather name="search" size={23} color={color(palette.ink, 'ink')} /></Pressable>
      </View>
      <Pressable accessibilityRole="button" style={listStyles.filter} disabled={state.loading}
        onPress={() => { void controller.list({ archived: !state.archived }); }}>
        <Text style={styles.subtitle}>{state.archived ? t("已归档 ▾") : t("最近聊天 ▾")}</Text>
      </Pressable>
    </View>
    <ChatThreadList state={state} controller={controller} newChat={newChat} select={select}
      openActions={actions.open} bottomInset={footerHeight} />
    <ChatThreadActions actions={actions} />
    <View style={listStyles.footer} pointerEvents="box-none"
      onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("新聊天")} disabled={state.sending}
        style={[listStyles.newChat, state.sending && styles.disabled]} onPress={() => newChat()}>
        <Feather name="edit" size={21} color="#fff" /><Text style={listStyles.newChatText}>{t("新聊天")}</Text>
      </Pressable>
      {profileMenu}
    </View>
  </View>;
}

const useListStyles = createThemedStyles((color) => ({
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  search: { width: 48, height: 48, borderRadius: 24, backgroundColor: color(palette.background, 'canvas'),
    alignItems: 'center', justifyContent: 'center' },
  filter: { minHeight: 36, justifyContent: 'center' },
  newChat: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    minHeight: 52, paddingHorizontal: 24, borderRadius: 26, backgroundColor: palette.green },
  newChatText: { color: '#fff', fontSize: 16, fontWeight: '600' },
}));
