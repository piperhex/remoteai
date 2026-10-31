import { useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Modal } from '../components/Modal';
import type { LoungeController } from '../../../../shared/lounge/controller';
import { MAX_MUTE_MINUTES, type LoungeAccount } from '../../../../shared/lounge/types';
import { displayText, t } from '../i18n';
import { pickLoungeImages } from './images';
import { LoungeAvatar } from './LoungeMessage';
import { useLoungeStyles } from './styles';

function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const styles = useLoungeStyles();
  return <Modal transparent animationType="fade" onRequestClose={close}>
    <View style={styles.overlay}><View style={styles.dialog}>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
      <Pressable accessibilityRole="button" style={styles.iconButton} onPress={close}>
        <Text style={styles.link}>{t('client.lounge.cancel')}</Text></Pressable>
    </View></View>
  </Modal>;
}

export function LoungeAvatarSettings({ user, controller, close }: {
  user: LoungeAccount; controller: LoungeController; close: () => void;
}) {
  const styles = useLoungeStyles();
  const [error, setError] = useState('');
  const [avatar, setAvatar] = useState(user.avatar ?? '');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const change = async (reset = false) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const value = reset ? '' : (await pickLoungeImages({ avatar: true })).images[0];
      if (value !== undefined) setAvatar(value);
    } catch (failure) {
      setError(failure instanceof Error && failure.message.startsWith('client.lounge.')
        ? failure.message : 'client.lounge.imageFailed');
    } finally { locked.current = false; setBusy(false); }
  };
  const save = async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await controller.setAvatar(avatar); close(); }
    catch { setError('client.lounge.avatarSaveFailed'); }
    finally { locked.current = false; setBusy(false); }
  };
  return <Dialog title={t('client.lounge.avatarSettings')} close={busy ? () => {} : close}>
    <LoungeAvatar user={{ ...user, avatar }} />
    <Text style={styles.muted}>{t('client.lounge.avatarHint')}</Text>
    <Pressable accessibilityRole="button" disabled={busy} style={styles.iconButton} onPress={() => void change()}>
      <Text style={styles.link}>{t('client.lounge.chooseAvatar')}</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy || !avatar}
      style={styles.iconButton} onPress={() => void change(true)}>
      <Text style={styles.link}>{t('client.lounge.resetAvatar')}</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={save}>
      <Text style={styles.buttonText}>{t('client.lounge.save')}</Text></Pressable>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{displayText(error)}</Text>}
  </Dialog>;
}

export function LoungeModeration({ user, controller, close }: {
  user: LoungeAccount; controller: LoungeController; close: () => void;
}) {
  const styles = useLoungeStyles();
  const [minutes, setMinutes] = useState('60');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const locked = useRef(false);
  const duration = Number(minutes);
  const valid = Number.isInteger(duration) && duration >= 1 && duration <= MAX_MUTE_MINUTES;
  const save = async (value: number) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(false);
    try { await controller.moderate(user.id, value); close(); }
    catch { setError(true); }
    finally { locked.current = false; setBusy(false); }
  };
  return <Dialog title={t('client.lounge.moderateTitle')} close={busy ? () => {} : close}>
    <Text style={styles.text}>{user.account}</Text>
    <Text style={styles.muted}>{t('client.lounge.duration')}</Text>
    <TextInput value={minutes} onChangeText={setMinutes} keyboardType="number-pad" editable={!busy}
      accessibilityLabel={t('client.lounge.duration')} style={styles.field} />
    <Text style={styles.muted}>{t('client.lounge.durationHint')}</Text>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" disabled={busy} style={styles.iconButton} onPress={() => void save(0)}>
        <Text style={styles.link}>{t('client.lounge.unmute')}</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy || !valid} onPress={() => void save(duration)}
        style={[styles.button, (busy || !valid) && styles.disabled]}>
        <Text style={styles.buttonText}>{t('client.lounge.mute')}</Text></Pressable>
    </View>
    {error && <Text accessibilityRole="alert" style={styles.error}>{t('client.lounge.moderationFailed')}</Text>}
  </Dialog>;
}
