import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Modal } from '../components/Modal';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { MobileLounge } from '../../../../shared/lounge/useMobileLounge';
import { contactStatus } from '../../../../shared/lounge/contacts';
import { t } from '../i18n';
import { textMetrics } from '../theme/text';
import { LoungeAvatar } from './LoungeMessage';
import { useLoungeStyles } from './styles';
import { createLoungeStyles, useLoungeColor } from './theme';
import type { LoungeController } from '../../../../shared/lounge/controller';
import { LoungeAvatarSettings } from './LoungeDialogs';
import { LoungeNameFields } from './LoungeNameFields';
import { accountName } from '../../../../shared/lounge/names';
import { useLoungeNameNavigation } from '../../../../shared/lounge/useLoungeNameNavigation';

const useProfileStyles = createLoungeStyles(color => ({
  cover: { height: 100, backgroundColor: color('#deebf7', 'infoSoft') },
  details: { marginTop: -24, paddingHorizontal: 24, paddingBottom: 32 },
  account: { ...textMetrics(20, 30), color: color('#202b33', 'ink'), fontWeight: '600', marginTop: 20, marginBottom: 10 },
  email: { ...textMetrics(13, 21), color: color('#687c89', 'muted'), marginBottom: 10 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statusText: { ...textMetrics(14, 21), color: color('#687c89', 'muted'), flexShrink: 1 },
  actions: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingVertical: 16 },
  delete: { borderWidth: 1, borderColor: color('#d5dfe6', 'border'), borderRadius: 14, padding: 12,
    minHeight: 48, justifyContent: 'center' },
  deleteText: { ...textMetrics(16, 24), color: color('#d34f55', 'danger') },
  send: { flex: 1, borderRadius: 14, backgroundColor: color('#456c96', 'info'), minHeight: 48,
    padding: 12, justifyContent: 'center', alignItems: 'center' },
  sendText: { ...textMetrics(16, 24), color: color('#f5f7f8', 'canvas') },
}));

export function LoungeProfile({ model, controller }: { model: MobileLounge; controller: LoungeController }) {
  const styles = useLoungeStyles(); const profileStyles = useProfileStyles(); const color = useLoungeColor();
  const navigation = useLoungeNameNavigation();
  const leave = (action: () => void) => { Keyboard.dismiss(); void navigation.leave(action); };
  const user = model.profile;
  if (!user) return null;
  const own = user.id === model.state.user?.id;
  const contact = model.state.contacts.find(value => value.user.id === user.id);
  const canDelete = model.state.directResetAvailable && model.state.status === 'connected';
  return <Modal animationType="slide" onRequestClose={() => leave(() => model.setProfile(undefined))}>
    <SafeAreaView style={styles.page}>
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('client.lounge.profileBack')}
          style={styles.iconButton} onPress={() => leave(() => model.setProfile(undefined))}>
          <Ionicons name="chevron-back" size={22} color={color('#202b33', 'ink')} /></Pressable>
        <Text accessibilityRole="header" style={styles.title}>{t('client.lounge.profile')}</Text>
      </View>
      <ScrollView style={styles.spacer} keyboardShouldPersistTaps="handled">
        <View style={profileStyles.cover} />
        <View style={profileStyles.details}><LoungeAvatar user={user} size="profile"
          onProfile={own ? () => leave(() => model.setAvatar(true)) : undefined} />
          <Text style={profileStyles.account}>{accountName(user)}</Text>
          {accountName(user) !== user.account && <Text style={profileStyles.email}>{user.account}</Text>}
          {contact?.direct && <View style={profileStyles.status}>
            <View style={[styles.onlineDot, (model.state.status !== 'connected' || contact.online !== true)
              && styles.offlineDot]} /><Text style={profileStyles.statusText}>{t(contactStatus(contact))}</Text></View>}
          <LoungeNameFields key={user.id} user={user} state={model.state} controller={controller}
            saveRef={navigation.saveRef} />
        </View>
      </ScrollView>
      <View style={profileStyles.actions}>
        {own ? <Pressable accessibilityRole="button" style={profileStyles.send}
          onPress={() => leave(() => model.setAvatar(true))}>
          <Text style={profileStyles.sendText}>{t('client.lounge.editAvatar')}</Text>
        </Pressable> : <><Pressable accessibilityRole="button" disabled={!canDelete}
          onPress={() => leave(() => model.setDeleting(user))}
          style={[profileStyles.delete, !canDelete && styles.disabled]}>
          <Text style={profileStyles.deleteText}>{t('client.lounge.deleteChat')}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={!model.state.directAvailable}
          onPress={() => leave(() => model.select(user))}
          style={[profileStyles.send, !model.state.directAvailable && styles.disabled]}>
          <Text style={profileStyles.sendText}>{t('client.lounge.sendMessage')}</Text></Pressable></>}
      </View>
      {own && model.avatar && <LoungeAvatarSettings user={user} controller={controller}
        close={() => model.setAvatar(false)} />}
    </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}
