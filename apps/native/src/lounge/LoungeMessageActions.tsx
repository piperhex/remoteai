import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Modal } from '../components/Modal';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import type { LoungeMessage } from '../../../../shared/lounge/types';
import { messageMenuActions } from '../../../../shared/lounge/messageMenuActions';
import { MESSAGE_MENU_PADDING, messageMenuPosition, messageMenuSize,
  type MenuAnchor } from '../../../../shared/lounge/messageMenuLayout';
import { t } from '../i18n';
import { textMetrics } from '../theme/text';

const icons = { copy: 'copy-outline', reply: 'chatbox-ellipses-outline',
  direct: 'chatbubbles-outline', block: 'ban-outline' } as const;
const MENU_MARGIN = 12;
const MENU_COLOR = '#5b5b5b';

export function LoungeMessageActions({ message, reply, close, direct, block, blocked, anchor }: {
  message: LoungeMessage; reply: (message: LoungeMessage) => void; close: () => void; anchor: MenuAnchor;
  direct?: () => void; block?: () => void; blocked?: boolean;
}) {
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [menuHeight, setMenuHeight] = useState(0);
  const [error, setError] = useState(false);
  const [copying, setCopying] = useState(false);
  const actions = messageMenuActions({ direct, block, blocked });
  const { width: menuWidth, columns } = messageMenuSize({ actionCount: actions.length, viewportWidth: width, fontScale });
  const viewport = { x: 0, y: insets.top, width, height: height - insets.top - insets.bottom };
  const position = messageMenuPosition({ anchor, menu: { width: menuWidth, height: menuHeight }, viewport });
  const copy = async () => {
    setCopying(true); setError(false);
    try {
      if (message.text) {
        if (!await Clipboard.setStringAsync(message.text)) throw new Error('clipboard-unavailable');
      } else {
        const image = message.images[0]?.split(',')[1];
        if (!image) throw new Error('clipboard-image-unavailable');
        await Clipboard.setImageAsync(image);
      }
      close();
    } catch { setError(true); }
    finally { setCopying(false); }
  };
  const select = (key: keyof typeof icons) => {
    if (key === 'copy') { void copy(); return; }
    close();
    if (key === 'direct') direct?.();
    else if (key === 'block') block?.();
    else reply(message);
  };
  // The modal and measureInWindow must share the same visible-window origin.
  return <Modal transparent animationType="fade" onRequestClose={close}>
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button"
        accessibilityLabel={t('client.lounge.cancel')} />
      <View accessibilityViewIsModal accessibilityLabel={t('client.lounge.messageActions')}
        onLayout={event => setMenuHeight(event.nativeEvent.layout.height)}
        style={[styles.menu, { width: menuWidth, left: position.left, top: position.top,
          opacity: menuHeight ? 1 : 0 }]}>
        <View pointerEvents="none" style={[styles.arrow, { left: position.arrow - 5 },
          position.above ? { bottom: -5 } : { top: -5 }]} />
        <ScrollView style={{ maxHeight: viewport.height - MENU_MARGIN * 2 }} keyboardShouldPersistTaps="handled">
          <View style={styles.actions}>{actions.map(action => <Pressable key={action.key}
            accessibilityRole="button" disabled={copying} onPress={() => select(action.key)}
            style={({ pressed }) => [styles.action, { width: `${100 / columns}%` }, pressed && styles.pressed]}>
            <Ionicons name={icons[action.key]} size={20} color="#fff" accessible={false} />
            <Text style={styles.label}>{t(action.label)}</Text>
          </Pressable>)}</View>
          {error && <Text accessibilityRole="alert" style={styles.label}>{t('client.lounge.messageCopyFailed')}</Text>}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  menu: { position: 'absolute', borderRadius: 12, padding: MESSAGE_MENU_PADDING, backgroundColor: MENU_COLOR,
    elevation: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  arrow: { position: 'absolute', width: 10, height: 10, borderRadius: 2,
    backgroundColor: MENU_COLOR, transform: [{ rotate: '45deg' }] },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
  action: { minHeight: 60, alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 6, paddingHorizontal: 4, borderRadius: 8 },
  label: { ...textMetrics(12, 18), color: '#fff', textAlign: 'center', flexShrink: 1 },
  pressed: { backgroundColor: '#ffffff20' },
});
