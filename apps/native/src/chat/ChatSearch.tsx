import { displayText } from '../i18n/index';
import { displayError } from '../i18n/index';
import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform,
  Pressable, Text, TextInput, View } from 'react-native';
import { Modal } from '../components/Modal';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import type { ChatController } from './controller';
import type { ChatState, Thread } from './types';
import { threadPresentation } from '../../../../shared/remote-chat/sidebar';
import { useChatSearch } from './useChatSearch';
import { palette, useStyles } from './styles';

interface Props { state: ChatState; controller: ChatController; onClose: () => void; select: (thread: Thread) => void }

export function ChatSearch({ state, controller, onClose, select }: Props) {
  const searchStyles = useSearchStyles();
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const [query, setQuery] = useState('');
  const input = useRef<TextInput>(null);
  const search = useChatSearch({ controller, query, archived: state.archived, ready: state.ready });
  const emptyMessage = !state.ready ? t("client.chat.connectToYourComputerToSearchChats") : query.trim() ? t("client.chat.noMatchingChats") : t("client.chat.enterKeywordsToFindAChat");
  return <Modal visible animationType="slide" statusBarTranslucent
    supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}
    onRequestClose={onClose} onShow={() => input.current?.focus()}>
    <SafeAreaView style={searchStyles.page}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={searchStyles.header}>
          <Text accessibilityRole="header" style={searchStyles.label}>{t("client.app.chat")}</Text>
          {state.archived && <Text style={styles.subtitle}>{t("client.mobile.archived")}</Text>}
        </View>
        <FlatList data={search.threads} keyExtractor={(thread) => thread.id} style={styles.fill}
          contentContainerStyle={searchStyles.results} keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag" renderItem={({ item }) => {
            const view = threadPresentation(item, state.sidebar, displayText);
            return <Pressable accessibilityRole="button" accessibilityLabel={view.title}
              disabled={!state.ready || state.sending} style={searchStyles.result} onPress={() => select(item)}>
              <View style={searchStyles.glyph}><Feather name="message-square" size={21} color={color(palette.ink, 'ink')} /></View>
              <View style={styles.fill}><Text numberOfLines={1} style={searchStyles.title}>{view.title}</Text>
                <Text numberOfLines={1} style={styles.subtitle}>{view.projectName}</Text></View>
            </Pressable>;
          }}
          ListEmptyComponent={!search.loading && !search.error
            ? <Text style={searchStyles.empty}>{emptyMessage}</Text> : null}
          ListFooterComponent={<View style={searchStyles.status}>
            {search.loading && <ActivityIndicator accessibilityLabel={t("client.mobile.searching")} color={color(palette.green, 'accent')} />}
            {!!search.error && <><Text accessibilityRole="alert" style={styles.error}>{displayError(search.error)}</Text>
              <Pressable accessibilityRole="button" style={styles.button} onPress={search.reload}>
                <Text style={styles.buttonText}>{t("client.terminal.retry")}</Text></Pressable></>}
            {!!search.cursor && !search.loading && !search.error && <Pressable accessibilityRole="button"
              disabled={!state.ready} style={styles.button} onPress={search.loadMore}>
              <Text style={styles.buttonText}>{t("client.chat.loadMore")}</Text></Pressable>}
          </View>} />
        <View style={searchStyles.toolbar}>
          <View style={searchStyles.field}>
            <Feather name="search" size={21} color={color(palette.muted, 'muted')} />
            <TextInput ref={input} accessibilityLabel={t("client.chat.searchChats")} placeholder={t("client.chat.searchChats")} value={query}
              onChangeText={setQuery} style={searchStyles.input} placeholderTextColor={color(palette.muted, 'muted')}
              autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={search.reload}
              blurOnSubmit={false} />
            {!!query && <Pressable accessibilityRole="button" accessibilityLabel={t("client.projectBrowser.clearSearch")}
              style={searchStyles.clear} onPress={() => { setQuery(''); input.current?.focus(); }}>
              <Feather name="x-circle" size={21} color={color(palette.muted, 'muted')} /></Pressable>}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("client.mobile.closeSearch")} style={searchStyles.close}
            onPress={onClose}><Feather name="x" size={25} color={color(palette.ink, 'ink')} /></Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

const useSearchStyles = createThemedStyles((color) => ({
  page: { flex: 1, backgroundColor: color('#fff', 'surface') },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { color: color(palette.ink, 'ink'), fontSize: 17, fontWeight: '600', borderRadius: 24,
    backgroundColor: color(palette.background, 'canvas'), paddingHorizontal: 20, paddingVertical: 12, overflow: 'hidden' },
  results: { paddingHorizontal: 20, paddingBottom: 16 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 72, paddingVertical: 10 },
  glyph: { width: 44, height: 44, borderRadius: 14, backgroundColor: color(palette.background, 'canvas'),
    alignItems: 'center', justifyContent: 'center' },
  title: { color: color(palette.ink, 'ink'), fontSize: 15, lineHeight: 24 },
  empty: { color: color(palette.muted, 'muted'), fontSize: 14, textAlign: 'center', paddingVertical: 40 },
  status: { gap: 8, paddingVertical: 12 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: color(palette.background, 'canvas') },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 16,
    paddingRight: 4, minHeight: 52, borderRadius: 28, backgroundColor: color('#fff', 'surface') },
  input: { flex: 1, minWidth: 0, color: color(palette.ink, 'ink'), fontSize: 16, paddingHorizontal: 10, paddingVertical: 14 },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  close: { width: 52, height: 52, borderRadius: 26, backgroundColor: color('#fff', 'surface'),
    alignItems: 'center', justifyContent: 'center' },
}));
