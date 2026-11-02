import Feather from '@expo/vector-icons/Feather';
import { Pressable, Text, View } from 'react-native';
import type { ProjectActionsModel } from '../../../../shared/remote-chat/client/useProjectActions';
import { BottomSheet } from '../components/BottomSheet';
import { displayError, t, useLanguage } from '../i18n';
import { createThemedStyles } from '../theme/styles';
import { textMetrics } from '../theme/text';
import { palette } from './styles';
import { useGrouping } from '../../../../shared/chat/groups/context';

export function ChatProjectActions({ actions }: { actions: ProjectActionsModel }) {
  const groups = useGrouping();
  useLanguage();
  const styles = useStyles();
  if (!actions.target) return null;
  const { target, pinned, confirmRemove, busy, error, reason } = actions;
  const disabled = busy || !!reason;
  return <BottomSheet visible truncateTitle maxWidth={400} dismissible={!busy} onClose={actions.close}
    title={confirmRemove ? t('client.projectActions.removeTitle')
      : t('client.conversation.manageProject', { value1: target.label })}
    onBack={confirmRemove && !busy ? () => actions.confirm(false) : undefined}
    actions={confirmRemove ? [
      { label: t('client.accounts.cancel'), onPress: actions.close, disabled: busy },
      { label: t('client.conversation.removeProject'), onPress: () => actions.submit('remove'),
        loading: busy, disabled },
    ] : []}>
    <View style={styles.content}>
      {confirmRemove ? <Text style={styles.copy}>{t('client.projectActions.removeDescription')}</Text> : <>
        {groups && <Pressable accessibilityRole="button" disabled={!groups.ready} style={styles.action}
          onPress={() => { groups.setMoveTarget({ kind: 'project', id: target.cwd }); actions.close(); }}>
          <Feather name="layers" size={20} style={styles.icon} />
          <Text style={styles.label}>{t('client.groups.move')}</Text>
        </Pressable>}
        <Pressable accessibilityRole="button" disabled={disabled} style={[styles.action, disabled && styles.disabled]}
          accessibilityLabel={t(pinned ? 'client.conversation.unpin' : 'client.conversation.pin')}
          onPress={() => { void actions.submit(pinned ? 'unpin' : 'pin'); }}>
          <Feather name="bookmark" size={20} style={styles.icon} />
          <Text style={styles.label}>{t(pinned ? 'client.conversation.unpin' : 'client.conversation.pin')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={disabled} style={[styles.action, disabled && styles.disabled]}
          accessibilityLabel={t('client.conversation.removeProject')}
          onPress={() => actions.confirm(true)}>
          <Feather name="x" size={20} style={styles.icon} />
          <Text style={styles.label}>{t('client.conversation.removeProject')}</Text>
        </Pressable>
      </>}
      {!!(error || reason) && <Text accessibilityRole="alert" style={[styles.copy, error && styles.error]}>
        {displayError(error || reason)}</Text>}
    </View>
  </BottomSheet>;
}

const useStyles = createThemedStyles(color => ({
  content: { gap: 8, paddingBottom: 12 },
  action: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 10 },
  label: { ...textMetrics(16, 24), color: color(palette.ink, 'ink'), flex: 1, minWidth: 0 },
  copy: { ...textMetrics(15, 24), color: color(palette.ink, 'ink') },
  icon: { color: color(palette.ink, 'ink'), flexShrink: 0 },
  error: { color: color(palette.danger, 'danger') },
  disabled: { opacity: 0.45 },
}));
