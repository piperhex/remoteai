import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import Feather from '@expo/vector-icons/Feather';
import { FlatList, Pressable, Text, View } from 'react-native';
import { conversationCandidates,
  conversationReference } from '../../../desktop/src/pages/codexGui/conversationReferences';
import type { AttachmentReference } from '../../../desktop/src/pages/codexGui/attachmentTypes';
import { useConversationCandidates, type ConversationSearch } from '../../../../shared/chat/useConversationCandidates';

interface Props {
  query: string;
  threadId: string | null;
  ready: boolean;
  load: ConversationSearch;
  choose: (reference: AttachmentReference) => void;
  close: () => void;
}

export function ComposerConversationMenu({ query, threadId, ready, load, choose, close }: Props) {
  const menuStyles = useMenuStyles();
  const color = useThemeColor();
  useLanguage();
  const result = useConversationCandidates({ active: true, connected: ready, query, load });
  const threads = conversationCandidates({ remote: result.threads, known: [], conversations: {},
    currentId: threadId, query });
  return <View accessibilityLabel={t("对话列表")} style={menuStyles.root}>
    <View style={menuStyles.heading}>
      <Text style={menuStyles.headingText}>{t("对话")}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t("关闭对话列表")} onPress={close} hitSlop={8}>
        <Feather name="x" size={18} color={color("#777", 'muted')} />
      </Pressable>
    </View>
    <FlatList data={threads} keyExtractor={thread => thread.id} style={menuStyles.list}
      keyboardShouldPersistTaps="always" nestedScrollEnabled
      renderItem={({ item }) => <Pressable accessibilityRole="menuitem" disabled={!ready}
        accessibilityLabel={t("引用对话 {value1}", { value1: conversationReference(item).name })}
        onPress={() => choose(conversationReference(item))}
        style={({ pressed }) => [menuStyles.option, pressed && menuStyles.pressed]}>
        <Text numberOfLines={1} style={menuStyles.title}>{conversationReference(item).name}</Text>
        <Text numberOfLines={1} style={menuStyles.detail}>
          {item.status?.type === 'active' ? t("运行中") : t("空闲")} · {item.cwd || t("未选择项目")}</Text>
      </Pressable>}
      ListFooterComponent={<>
        {!ready && <Text style={menuStyles.message}>{t("连接后即可引用对话")}</Text>}
        {ready && result.loading && !threads.length && <Text style={menuStyles.message}>{t("正在加载对话…")}</Text>}
        {ready && !!result.error && <Text accessibilityRole="alert" style={menuStyles.message}>{result.error}</Text>}
        {ready && !result.loading && !result.error && !threads.length
          && <Text style={menuStyles.message}>{t("没有找到可引用的对话")}</Text>}
      </>} />
  </View>;
}

const textInsets = { includeFontPadding: true, paddingVertical: 2 };
const useMenuStyles = createThemedStyles((color) => ({
  root: { flexShrink: 1 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  headingText: { ...textInsets, color: color('#777', 'muted'), fontSize: 13, lineHeight: 20 },
  list: { maxHeight: 250, flexGrow: 0 },
  option: { minHeight: 60, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  title: { ...textInsets, color: color('#161616', 'ink'), fontSize: 15, lineHeight: 22 },
  detail: { ...textInsets, color: color('#777', 'muted'), fontSize: 12, lineHeight: 18 },
  message: { ...textInsets, color: color('#777', 'muted'), fontSize: 12, lineHeight: 18, margin: 12, maxWidth: 400 },
  pressed: { backgroundColor: color('#f2f2f2', 'elevated') },
}));
