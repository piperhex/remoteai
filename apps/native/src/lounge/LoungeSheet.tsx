import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Modal } from '../components/Modal';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../i18n';
import { useLoungeStyles } from './styles';
import { useLoungeColor } from './theme';

export function LoungeSheet({ title, close, children, keyboardAware = false }: {
  title: ReactNode; close: () => void; children: ReactNode; keyboardAware?: boolean;
}) {
  const styles = useLoungeStyles();
  const color = useLoungeColor();
  const insets = useSafeAreaInsets();
  return <Modal transparent animationType="slide" onRequestClose={close}>
    <KeyboardAvoidingView style={styles.sheetOverlay} enabled={keyboardAware}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={styles.sheetBackdrop} onPress={close} accessibilityLabel={t('client.lounge.cancel')}
        accessibilityRole="button" />
      <View style={[styles.sheet, { paddingBottom: Math.max(24, insets.bottom) }]} accessibilityViewIsModal>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          {typeof title === 'string' ? <Text accessibilityRole="header" style={styles.title}>{title}</Text> : title}
          <Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel={t('client.lounge.cancel')}
            onPress={close}><Ionicons name="close" size={22} color={color('#687c89', 'muted')} /></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

export function LoungeAbout({ direct, close }: { direct: boolean; close: () => void }) {
  const styles = useLoungeStyles();
  const color = useLoungeColor();
  return <LoungeSheet title={t('client.lounge.about')} close={close}>
    <View style={styles.infoRow}><Ionicons name="save-outline" size={21} color={color('#456c96', 'info')} />
      <View style={styles.heading}><Text style={styles.rowTitle}>{t('client.lounge.localTitle')}</Text>
        <Text style={styles.muted}>{t('client.lounge.localHint')}</Text></View></View>
    <View style={styles.infoRow}><Ionicons name="server-outline" size={21} color={color('#456c96', 'info')} />
      <View style={styles.heading}><Text style={styles.rowTitle}>{t('client.lounge.serverTitle')}</Text>
        <Text style={styles.muted}>{t(direct ? 'client.lounge.directOfflineHint' : 'client.lounge.groupOfflineHint')}</Text>
      </View></View>
    <Pressable accessibilityRole="button" onPress={close} style={styles.button}>
      <Text style={styles.buttonText}>{t('client.lounge.done')}</Text></Pressable>
  </LoungeSheet>;
}
