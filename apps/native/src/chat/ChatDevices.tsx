import { t, useLanguage } from '../i18n';
import { Pressable, Text, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { SheetScrollView, SHEET_READABLE_WIDTH } from '../components/SheetScrollView';
import type { RemoteDevice } from '../types';
import { useStyles } from './styles';

export function ChatDevices({ devices, choose, onClose }: {
  devices: RemoteDevice[]; choose: (id: string) => void; onClose: () => void;
}) {
  const styles = useStyles();
  useLanguage();
  return <BottomSheet fullWidthContent visible title={t("选择电脑")} onClose={onClose}>
    <SheetScrollView contentContainerStyle={[styles.settings, { maxWidth: SHEET_READABLE_WIDTH }]}>
      {devices.map((device) => <Pressable key={device.deviceId} accessibilityRole="button"
        style={styles.card}
        onPress={() => choose(device.deviceId)}>
        <View style={styles.row}><Text style={[styles.title, styles.fill]}>{device.name}</Text>
          <Text style={styles.subtitle}>{device.online ? t("在线") : t("离线")}</Text></View>
      </Pressable>)}
      {!devices.length && <Text style={styles.subtitle}>{t("在电脑上打开 Remote AI 并登录同一账号，即可开始聊天。")}</Text>}
    </SheetScrollView>
  </BottomSheet>;
}
