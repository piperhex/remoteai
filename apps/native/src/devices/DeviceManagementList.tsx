import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { AccountSummary, RemoteDevice, RemoteProviderSummary } from '../types';
import { DeviceCard } from './DeviceCard';
import { DeviceOptionsMenu } from './DeviceOptionsMenu';
import { deviceColors, useStyles } from './styles';

interface DeviceManagementListProps {
  devices: RemoteDevice[];
  accounts: AccountSummary[];
  providers: RemoteProviderSummary[];
  refreshing: boolean;
  deletingDeviceId: string | null;
  switchingModelDeviceId: string | null;
  switchingAuthDeviceId: string | null;
  onRefresh: () => Promise<void>;
  onDelete: (device: RemoteDevice) => void;
  onRevokeService: (device: RemoteDevice) => void;
  onSwitchModel: (deviceId: string) => void;
  onSelectAuthAccount: (deviceId: string) => void;
}

function DeviceOverview({ devices }: { devices: RemoteDevice[] }) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const online = devices.filter((device) => device.online).length;
  return <View style={styles.summary}>
    <View style={styles.stat}>
      <View style={styles.statIcon}>
        <Ionicons name="phone-portrait-outline" size={25} color={color(deviceColors.green, 'accent')} />
      </View>
      <View style={styles.identity}>
        <Text style={styles.statValue}>{online}</Text>
        <View style={styles.statLabelRow}><View style={styles.dot} /><Text style={styles.statLabel}>{t("当前在线")}</Text></View>
      </View>
    </View>
    <View style={styles.stat}>
      <View style={styles.statIcon}><Ionicons name="layers-outline" size={27} color={color(deviceColors.green, 'accent')} /></View>
      <View style={styles.identity}><Text style={styles.statValue}>{devices.length}</Text>
        <Text style={[styles.statLabel, { marginTop: 3 }]}>{t("全部设备")}</Text></View>
    </View>
  </View>;
}

export function DeviceManagementList(props: DeviceManagementListProps) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const [menuDeviceId, setMenuDeviceId] = useState<string | null>(null);
  const { devices, refreshing, onRefresh } = props;
  const menuDevice = devices.find((device) => device.deviceId === menuDeviceId) ?? null;
  return <>
    <ScrollView style={styles.page} contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()}
        tintColor={color(deviceColors.green, 'accent')} colors={[deviceColors.green]} />}>
      <View style={styles.header}>
        <Text style={styles.heading}>{t("设备管理")}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("刷新设备列表")} disabled={refreshing}
          accessibilityState={{ disabled: refreshing, busy: refreshing }} onPress={() => void onRefresh()}
          style={({ pressed }) => [styles.refresh, pressed && styles.pressed]}>
          {refreshing ? <ActivityIndicator color={color(deviceColors.green, 'accent')} />
            : <Ionicons name="sync-outline" size={23} color={color(deviceColors.green, 'accent')} />}
        </Pressable>
      </View>
      <Text style={styles.subtitle}>{t("查看设备状态，点击卡片切换模型")}</Text>
      <DeviceOverview devices={devices} />
      <Text style={styles.listTitle}>
        {t("已登录设备")}{' '}<Text style={styles.listCount}>({devices.length})</Text>
      </Text>
      {devices.map((device) => <DeviceCard key={device.deviceId} device={device}
        accounts={props.accounts} providers={props.providers}
        busy={props.switchingModelDeviceId === device.deviceId || props.deletingDeviceId === device.deviceId}
        onSwitchModel={() => props.onSwitchModel(device.deviceId)}
        onOpenMenu={() => setMenuDeviceId(device.deviceId)} />)}
      {devices.length ? <View style={styles.hint}>
        <Ionicons name="information-circle-outline" size={23} color={color(deviceColors.green, 'accent')} />
        <Text style={styles.hintText}>{t("在线设备暂不支持删除。")}{'\n'}{t("如需移除，请先在该设备上退出登录。")}</Text>
      </View> : <View style={styles.empty}>
        <Ionicons name="desktop-outline" size={40} color={color(deviceColors.green, 'accent')} />
        <Text style={styles.emptyTitle}>{t("暂无设备")}</Text>
        <Text style={styles.emptyText}>{t("在电脑上登录同一账号，设备就会自动出现在这里。")}</Text>
      </View>}
    </ScrollView>
    <DeviceOptionsMenu device={menuDevice} deletingDeviceId={props.deletingDeviceId}
      switchingAuthDeviceId={props.switchingAuthDeviceId} onClose={() => setMenuDeviceId(null)}
      onDelete={props.onDelete} onRevokeService={props.onRevokeService} onSelectAuthAccount={props.onSelectAuthAccount} />
  </>;
}
