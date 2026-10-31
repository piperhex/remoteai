import { Pressable, Text, View } from 'react-native';
import { Modal } from '../components/Modal';
import type { MobileLounge } from '../../../../shared/lounge/useMobileLounge';
import { t } from '../i18n';
import { useLoungeStyles } from './styles';

export function LoungeDeleteDialog({ model }: { model: MobileLounge }) {
  const styles = useLoungeStyles();
  const cancel = () => { if (!model.deleteBusy) model.setDeleting(undefined); };
  return <Modal visible={!!model.deleting} transparent animationType="fade" onRequestClose={cancel}>
    <View style={styles.overlay}><View style={styles.dialog} accessibilityViewIsModal>
      <Text accessibilityRole="header" style={styles.title}>{t('client.lounge.deleteTitle')}</Text>
      <Text style={styles.text}>{t('client.lounge.deleteConfirm')}</Text>
      {model.deleteError && <Text accessibilityRole="alert" style={styles.error}>{t('client.lounge.deleteFailed')}</Text>}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" disabled={model.deleteBusy} onPress={cancel} style={styles.iconButton}>
          <Text style={styles.link}>{t('client.lounge.cancel')}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={model.deleteBusy} onPress={() => void model.deleteContact()}
          style={[styles.iconButton, model.deleteBusy && styles.disabled]}>
          <Text style={styles.error}>{t('client.lounge.deleteChat')}</Text></Pressable>
      </View>
    </View></View>
  </Modal>;
}
