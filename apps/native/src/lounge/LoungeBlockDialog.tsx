import { accountName } from '../../../../shared/lounge/names';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Modal } from '../components/Modal';
import type { LoungeAccount } from '../../../../shared/lounge/types';
import type { LoungeController } from '../../../../shared/lounge/controller';
import { t } from '../i18n';
import { useLoungeStyles } from './styles';

export function LoungeBlockDialog({ user, blocked, controller, close }: {
  user: LoungeAccount; blocked: boolean; controller: LoungeController; close: () => void;
}) {
  const styles = useLoungeStyles();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const submit = async () => {
    if (busy) return;
    setBusy(true); setError(false);
    try { await controller.block(user.id, !blocked); close(); }
    catch { setError(true); }
    finally { setBusy(false); }
  };
  return <Modal transparent animationType="fade" onRequestClose={() => { if (!busy) close(); }}>
    <View style={styles.overlay}><View style={styles.dialog}>
      <Text style={styles.title}>{blocked ? t('client.lounge.unblockUser')
        : t('client.lounge.blockConfirm', { account: accountName(user) })}</Text>
      <Text style={styles.text}>{blocked ? user.account : t('client.lounge.blockHint')}</Text>
      {error && <Text accessibilityRole="alert" style={styles.error}>{t('client.lounge.actionFailed')}</Text>}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" disabled={busy} style={styles.iconButton} onPress={close}>
          <Text style={styles.link}>{t('client.lounge.cancel')}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} style={styles.iconButton} onPress={() => void submit()}>
          <Text style={styles.link}>{t(blocked ? 'client.lounge.unblockUser' : 'client.lounge.blockUser')}</Text></Pressable>
      </View>
    </View></View>
  </Modal>;
}
