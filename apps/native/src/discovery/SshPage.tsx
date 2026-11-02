import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { GuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { sshLabel } from '../../../../shared/terminal/sshProfiles';
import { useSshDiscovery } from '../../../../shared/terminal/useSshDiscovery';
import type { RemoteDevice } from '../types';
import { displayError, t, useLanguage } from '../i18n';
import { createThemedStyles } from '../theme/styles';
import { textMetrics } from '../theme/text';
import { useThemeColor } from '../theme/store';
import { ChatDevices } from '../chat/ChatDevices';
import { ChatTerminal } from '../chat/ChatTerminal';
import { SshQuickConnectSheet } from '../chat/terminal/SshQuickConnectSheet';
import { SshButton } from '../chat/terminal/SshControls';
import { BottomSheet } from '../components/BottomSheet';
import { DiscoveryBackButton } from './DiscoveryPage';

export function SshPage({ client, connected, deviceName, devices, chooseDevice, onBack }: {
  client: GuiToolsClient['terminal']; connected: boolean; deviceName?: string;
  devices: RemoteDevice[]; chooseDevice: (id: string) => void; onBack: () => void;
}) {
  useLanguage();
  const styles = useStyles();
  const color = useThemeColor();
  const { saved, profile, choose, close, panel } = useSshDiscovery(client, connected);
  const [picking, setPicking] = useState(false);
  return <View style={styles.page}>
    <DiscoveryBackButton onBack={onBack} />
    <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>
      {t('client.discovery.ssh')}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t('client.settings.chooseAComputer')}
        onPress={() => setPicking(true)} style={styles.device}>
        <Text style={styles.hint}>{deviceName || t('client.settings.chooseAComputer')}</Text>
        <Ionicons name="chevron-down" size={18} color={color('#777', 'muted')} />
      </Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.content} refreshControl={
      <RefreshControl refreshing={saved.loading} onRefresh={() => void saved.refresh()} />}>
      <View style={styles.section}><Text style={styles.hint}>{t('client.ssh.savedConnections')}</Text>
        <SshButton label={t('client.ssh.refresh')} disabled={saved.loading} onPress={() => void saved.refresh()} />
      </View>
      {!connected && <Text style={styles.hint}>{t('client.discovery.sshComputerHint')}</Text>}
      {!!saved.error && <Text accessibilityRole="alert" style={styles.error}>{displayError(saved.error)}</Text>}
      {saved.profiles.map(item => <Pressable key={item.id} accessibilityRole="button"
        disabled={saved.loading || !!saved.error} onPress={() => choose(item)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <Ionicons name="terminal-outline" size={24} color={color('#07b775', 'accent')} />
        <View style={styles.labels}><Text style={styles.name}>{item.name || sshLabel(item)}</Text>
          {!!item.name && <Text style={styles.hint}>{sshLabel(item)}</Text>}</View>
        <Ionicons name="chevron-forward" size={20} color={color('#777', 'muted')} />
      </Pressable>)}
      {!saved.loading && !saved.error && !saved.profiles.length && <View style={styles.empty}>
        <Text style={styles.name}>{t('client.ssh.noSavedConnections')}</Text>
        <Text style={styles.hint}>{t('client.ssh.emptyConnectionsHint')}</Text>
      </View>}
    </ScrollView>
    <ChatTerminal client={client} cwd="" active connected={connected} deviceName={deviceName} hideTrigger panel={panel} />
    {profile && connected && <SshQuickConnectSheet key={profile.id} api={client.ssh} profile={profile} cwd=""
      connected={panel.adopt} dispose={client.close} close={close} />}
    {profile && !connected && !picking && <BottomSheet visible title={profile.name || sshLabel(profile)}
      onClose={close} maxWidth={400}>
      <ActivityIndicator /><Text style={styles.hint}>{t('client.discovery.sshComputerHint')}</Text>
      <SshButton label={t('client.settings.chooseAComputer')} onPress={() => setPicking(true)} />
    </BottomSheet>}
    {picking && <ChatDevices devices={devices} onClose={() => setPicking(false)}
      choose={id => { setPicking(false); chooseDevice(id); }} />}
  </View>;
}

const useStyles = createThemedStyles(color => ({
  page: { flex: 1, backgroundColor: color('#ededed', 'canvas') },
  heading: { paddingHorizontal: 20, paddingBottom: 16, gap: 8 },
  title: { ...textMetrics(24, 34), fontWeight: '600', color: color('#181818', 'ink') },
  device: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8, minHeight: 44 },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 12,
    backgroundColor: color('#fff', 'surface') },
  labels: { flex: 1, gap: 4 },
  name: { ...textMetrics(17, 26), color: color('#181818', 'ink'), fontWeight: '500' },
  hint: { ...textMetrics(14, 22), flexShrink: 1, color: color('#777', 'muted') },
  error: { ...textMetrics(14, 22), color: color('#d9534f', 'danger') },
  empty: { paddingVertical: 32, gap: 8, alignItems: 'center' },
  pressed: { opacity: 0.65 },
}));
