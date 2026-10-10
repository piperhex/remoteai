import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { RemoteDevice } from '../types';
import { deviceColors, useStyles } from './styles';

interface DeviceOptionsMenuProps {
  device: RemoteDevice | null;
  deletingDeviceId: string | null;
  switchingAuthDeviceId: string | null;
  onClose: () => void;
  onDelete: (device: RemoteDevice) => void;
  onRevokeService: (device: RemoteDevice) => void;
  onSelectAuthAccount: (deviceId: string) => void;
}

export function DeviceOptionsMenu(props: DeviceOptionsMenuProps) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const { device, deletingDeviceId, switchingAuthDeviceId, onClose, onDelete, onSelectAuthAccount } = props;
  if (!device) return null;
  const deleteDisabled = device.online || Boolean(deletingDeviceId);
  const authDisabled = !device.online || Boolean(switchingAuthDeviceId);
  return <Modal transparent visible animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <Pressable accessibilityLabel={t("关闭菜单")} accessibilityRole="button"
        style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.menu} accessibilityViewIsModal>
        <View style={styles.menuHeader}>
          <Text style={styles.menuTitle}>{device.name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t("关闭菜单")} onPress={onClose} style={styles.close}>
            <Ionicons name="close" size={22} color={color(deviceColors.muted, 'muted')} />
          </Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: authDisabled }} disabled={authDisabled}
          onPress={() => { onClose(); onSelectAuthAccount(device.deviceId); }}
          style={({ pressed }) => [styles.option, pressed && styles.pressed, authDisabled && styles.disabled]}>
          <Ionicons name="open-outline" size={21} color={color(deviceColors.green, 'accent')} />
          <Text style={styles.optionLabel}>{t("代理登录态账号")}</Text>
          {switchingAuthDeviceId === device.deviceId && <ActivityIndicator color={color(deviceColors.green, 'accent')} />}
        </Pressable>
        {device.platform.toLowerCase() === 'windows' && <Pressable accessibilityRole="button"
          onPress={() => { onClose(); props.onRevokeService(device); }} style={styles.option}>
          <Ionicons name="lock-closed-outline" size={21} color={color(deviceColors.danger, 'danger')} />
          <Text style={[styles.optionLabel, styles.danger]}>{t("撤销无人值守授权")}</Text>
        </Pressable>}
        <Pressable accessibilityRole="button"
          accessibilityState={{ disabled: deleteDisabled }} disabled={deleteDisabled}
          onPress={() => { onClose(); onDelete(device); }}
          style={({ pressed }) => [styles.option, pressed && styles.pressed, deleteDisabled && styles.disabled]}>
          <Ionicons name="trash-outline" size={21} color={color(deviceColors.danger, 'danger')} />
          <Text style={[styles.optionLabel, styles.danger]}>{device.online ? t("在线不可删除") : t("删除设备")}</Text>
          {deletingDeviceId === device.deviceId && <ActivityIndicator color={color(deviceColors.danger, 'danger')} />}
        </Pressable>
        {!device.online && <Text style={styles.hintText}>{t("设备上线后可更换代理登录态账号。")}</Text>}
      </View>
    </View>
  </Modal>;
}
