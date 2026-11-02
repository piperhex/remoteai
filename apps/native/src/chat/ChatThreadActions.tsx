import { displayError, displayText } from '../i18n/index';
import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { Pressable, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { BottomSheet } from '../components/BottomSheet';
import { THREAD_NAME_LIMIT, type ThreadAction } from '../../../../shared/remote-chat/client/threadActions';
import type { ThreadActionsModel } from '../../../../shared/remote-chat/client/useThreadActions';
import { palette, useStyles } from './styles';
import { useGrouping } from '../../../../shared/chat/groups/context';
import { textMetrics } from '../theme/text';

export function ChatThreadActions({ actions }: { actions: ThreadActionsModel }) {
  const groups = useGrouping();
  const actionStyles = useActionStyles();
  const styles = useStyles();
  useLanguage();
  if (!actions.target) return null;
  const { view, busy, error, name, reason } = actions;
  const archive: ThreadAction = actions.target.archived ? 'unarchive' : 'archive';
  const titles = { menu: t("client.mobile.actions", { value1: actions.target.title }), rename: t("client.threadActions.renameChat"), delete: t("client.threadActions.deleteThisChat") };
  const title = titles[view];
  const hint = reason(view === 'menu' ? archive : view);
  return <BottomSheet visible title={title} truncateTitle maxWidth={400} dismissible={!busy}
    onClose={actions.close} onBack={view !== 'menu' && !busy ? () => actions.changeView('menu') : undefined}
    actions={view === 'menu' ? [] : [
      { label: t("client.accounts.cancel"), onPress: actions.close, disabled: busy },
      { label: view === 'rename' ? t("client.projectBrowser.save") : t("client.projectBrowser.deleted"), tone: view === 'delete' ? 'danger' : 'primary',
        loading: busy, disabled: !!hint || (view === 'rename' && !name.trim()),
        onPress: () => actions.submit(view) },
    ]}>
    <View style={actionStyles.content}>
      {view === 'menu' && <>
        {groups && <Action label={t('client.groups.move')} icon="layers" disabled={!groups.ready}
          onPress={() => { groups.setMoveTarget({ kind: 'thread', id: actions.target!.thread.id }); actions.close(); }} />}
        <Action label={t("client.projectBrowser.renamed")} icon="edit-2" disabled={!!reason('rename')} onPress={() => actions.changeView('rename')} />
        <Action label={actions.target.archived ? t("client.chat.restore") : t("client.threadActions.archive")} icon="archive" disabled={!!reason(archive)}
          onPress={() => { void actions.submit(archive); }} />
        <Action label={t("client.projectBrowser.deleted")} icon="trash-2" danger disabled={!!reason('delete')}
          onPress={() => actions.changeView('delete')} />
      </>}
      {view === 'rename' && <TextInput accessibilityLabel={t("client.threadActions.chatName")} value={name} onChangeText={actions.setName}
        style={actionStyles.input} maxLength={THREAD_NAME_LIMIT} autoFocus selectTextOnFocus editable={!busy}
        returnKeyType="done" onSubmitEditing={() => { if (!hint && name.trim()) void actions.submit('rename'); }} />}
      {view === 'delete' && <Text style={actionStyles.copy}>
        {t("client.threadActions.thisChatAndAllItsChildChatsWillMoveTo")}</Text>}
      {!!(error || hint) && <Text accessibilityRole="alert" style={error ? styles.error : styles.subtitle}>
        {error ? displayError(error) : displayText(hint || '')}</Text>}
    </View>
  </BottomSheet>;
}

function Action({ label, icon, disabled, danger, onPress }: {
  label: string; icon: 'edit-2' | 'archive' | 'trash-2' | 'layers'; disabled: boolean; danger?: boolean; onPress: () => void;
}) {
  const actionStyles = useActionStyles();
  const styles = useStyles();
  const themeColor = useThemeColor();
  useLanguage();
  const color = danger ? themeColor(palette.danger, 'danger') : themeColor(palette.ink, 'ink');
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={[actionStyles.action, disabled && styles.disabled]}>
    <Feather name={icon} size={20} color={color} /><Text style={[actionStyles.label, { color }]}>{label}</Text>
  </Pressable>;
}

const useActionStyles = createThemedStyles((color) => ({
  content: { gap: 8, paddingBottom: 12 },
  action: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 10 },
  // Leave room for Android's Chinese fallback font instead of using its exact measured bounds.
  label: { flex: 1, minWidth: 0, ...textMetrics(16, 24) },
  copy: { color: color(palette.ink, 'ink'), fontSize: 15, lineHeight: 24 },
  input: { borderWidth: 1, borderColor: color(palette.border, 'border'), borderRadius: 12, padding: 12, color: color(palette.ink, 'ink'), fontSize: 16 },
}));
