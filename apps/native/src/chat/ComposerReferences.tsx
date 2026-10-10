import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { useRef } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { AttachmentReference } from '../../../desktop/src/pages/codexGui/attachmentTypes';
import { itemUploadProgress, type UploadProgress } from '../../../../shared/remote-chat/uploadProgress';
import { ComposerUploadProgress } from './ComposerUploadProgress';

const referenceIcons = { file: 'file-text', folder: 'folder', plugin: 'box', conversation: 'message-square' } as const;

export function ComposerReferences({ items, disabled, remove, upload, reconnecting }: {
  items: AttachmentReference[]; disabled: boolean; remove: (item: AttachmentReference) => void;
  upload?: UploadProgress; reconnecting?: boolean;
}) {
  const referenceStyles = useReferenceStyles();
  const color = useThemeColor();
  useLanguage();
  const list = useRef<ScrollView>(null);
  if (!items.length) return null;
  return <ScrollView ref={list} horizontal keyboardShouldPersistTaps="always"
    onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
    contentContainerStyle={referenceStyles.list}>
    {items.map((item, index) => <View key={`${item.path}:${index}`} style={referenceStyles.item}>
      <Feather name={referenceIcons[item.kind]} size={18} color={color("#555", 'ink')} />
      <Text numberOfLines={1} style={referenceStyles.name}>{item.kind === 'conversation' ? `@${item.name}` : item.name}</Text>
      {!!item.data && <ComposerUploadProgress inline progress={itemUploadProgress(upload, 'attachment', index)}
        reconnecting={reconnecting} />}
      <Pressable accessibilityRole="button"
        accessibilityLabel={t("移除{value1} {value2}", { value1: item.kind === 'conversation' ? '对话引用' : '附件', value2: item.name })}
        disabled={disabled} onPress={() => remove(item)} hitSlop={8} style={referenceStyles.remove}>
        <Feather name="x" size={16} color={color("#666", 'ink')} />
      </Pressable>
    </View>)}
  </ScrollView>;
}

const useReferenceStyles = createThemedStyles((color) => ({
  list: { gap: 8, padding: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingVertical: 6,
    borderRadius: 12, backgroundColor: color('#f3f3f3', 'canvas'), maxWidth: 260 },
  name: { color: color('#222', 'ink'), fontSize: 13, lineHeight: 20, paddingVertical: 2,
    includeFontPadding: true, textAlignVertical: 'center', flexShrink: 1 },
  remove: { minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
}));
