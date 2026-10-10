import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { Pressable, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { BottomSheet } from '../components/BottomSheet';
import { THREAD_NAME_LIMIT, type ThreadAction } from '../../../../shared/remote-chat/client/threadActions';
import type { ThreadActionsModel } from '../../../../shared/remote-chat/client/useThreadActions';
import { palette, useStyles } from './styles';

export function ChatThreadActions({ actions }: { actions: ThreadActionsModel }) {
  const actionStyles = useActionStyles();
  const styles = useStyles();
  useLanguage();
  if (!actions.target) return null;
  const { view, busy, error, name, reason } = actions;
  const archive: ThreadAction = actions.target.archived ? 'unarchive' : 'archive';
  const titles = { menu: t("操作 - {value1}", { value1: actions.target.title }), rename: t("重命名对话"), delete: t("删除这条对话？") };
  const title = titles[view];
  const hint = reason(view === 'menu' ? archive : view);
  return <BottomSheet visible title={title} truncateTitle maxWidth={400} dismissible={!busy} dragFromHeaderOnly
    onClose={actions.close} onBack={view !== 'menu' && !busy ? () => actions.changeView('menu') : undefined}
    actions={view === 'menu' ? [] : [
      { label: t("取消"), onPress: actions.close, disabled: busy },
      { label: view === 'rename' ? t("保存") : t("删除"), tone: view === 'delete' ? 'danger' : 'primary',
        loading: busy, disabled: !!hint || (view === 'rename' && !name.trim()),
        onPress: () => actions.submit(view) },
    ]}>
    <View style={actionStyles.content}>
      {view === 'menu' && <>
        <Action label={t("重命名")} icon="edit-2" disabled={!!reason('rename')} onPress={() => actions.changeView('rename')} />
        <Action label={actions.target.archived ? t("恢复") : t("归档")} icon="archive" disabled={!!reason(archive)}
          onPress={() => { void actions.submit(archive); }} />
        <Action label={t("删除")} icon="trash-2" danger disabled={!!reason('delete')}
          onPress={() => actions.changeView('delete')} />
      </>}
      {view === 'rename' && <TextInput accessibilityLabel={t("对话名称")} value={name} onChangeText={actions.setName}
        style={actionStyles.input} maxLength={THREAD_NAME_LIMIT} autoFocus selectTextOnFocus editable={!busy}
        returnKeyType="done" onSubmitEditing={() => { if (!hint && name.trim()) void actions.submit('rename'); }} />}
      {view === 'delete' && <Text style={actionStyles.copy}>
        {t("这条对话及其所有子对话将一起移入回收站，可在电脑端“会话管理”中恢复。")}</Text>}
      {!!(error || hint) && <Text accessibilityRole="alert" style={error ? styles.error : styles.subtitle}>
        {error ? t(error) : t(hint || '')}</Text>}
    </View>
  </BottomSheet>;
}

function Action({ label, icon, disabled, danger, onPress }: {
  label: string; icon: 'edit-2' | 'archive' | 'trash-2'; disabled: boolean; danger?: boolean; onPress: () => void;
}) {
  const actionStyles = useActionStyles();
  const styles = useStyles();
  useLanguage();
  const color = danger ? palette.danger : palette.ink;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={[actionStyles.action, disabled && styles.disabled]}>
    <Feather name={icon} size={20} color={color} /><Text style={[actionStyles.label, { color }]}>{label}</Text>
  </Pressable>;
}

const useActionStyles = createThemedStyles((color) => ({
  content: { gap: 8, paddingBottom: 12 },
  action: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 10 },
  // Leave room for Android's Chinese fallback font instead of using its exact measured bounds.
  label: { flex: 1, minWidth: 0, fontSize: 16, lineHeight: 24, paddingVertical: 2,
    includeFontPadding: true, textAlignVertical: 'center' },
  copy: { color: color(palette.ink, 'ink'), fontSize: 15, lineHeight: 24 },
  input: { borderWidth: 1, borderColor: color(palette.border, 'border'), borderRadius: 12, padding: 12, color: color(palette.ink, 'ink'), fontSize: 16 },
}));
