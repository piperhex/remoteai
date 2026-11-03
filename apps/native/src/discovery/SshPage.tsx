import { Ionicons } from '@expo/vector-icons';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { GuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { sshLabel } from '../../../../shared/terminal/sshProfiles';
import { useSshDiscovery } from '../../../../shared/terminal/useSshDiscovery';
import { displayError, t, useLanguage } from '../i18n';
import { createThemedStyles } from '../theme/styles';
import { textMetrics } from '../theme/text';
import { useThemeColor } from '../theme/store';
import { ChatTerminal } from '../chat/ChatTerminal';
import { SshQuickConnectSheet } from '../chat/terminal/SshQuickConnectSheet';
import { SshConnectionSheet } from '../chat/terminal/SshConnectionSheet';
import { SshButton } from '../chat/terminal/SshControls';
import { DiscoveryBackButton } from './DiscoveryPage';

export function SshPage({ client, onBack }: {
  client: GuiToolsClient['terminal']; onBack: () => void;
}) {
  useLanguage();
  const styles = useStyles();
  const color = useThemeColor();
  const { saved, profile, choose, close, panel, editor, edit, closeEditor } = useSshDiscovery(client, true, true);
  return <View style={styles.page}>
    <View style={styles.header}>
      <View style={styles.headerSide}><DiscoveryBackButton onBack={onBack} /></View>
      <Text accessibilityRole="header" style={styles.title}>{t('client.discovery.ssh')}</Text>
      <View style={[styles.headerSide, styles.headerRight]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('client.ssh.createAction')}
          onPress={() => edit()} style={({ pressed }) => [styles.create, pressed && styles.pressed]}>
          <Ionicons name="add" size={20} color={color('#07b775', 'accent')} accessible={false} />
          <Text style={styles.createLabel}>{t('client.ssh.createAction')}</Text>
        </Pressable>
      </View>
    </View>
    <ScrollView contentContainerStyle={styles.content} refreshControl={
      <RefreshControl refreshing={saved.loading} onRefresh={() => void saved.refresh()} />}>
      <View style={styles.section}><Text style={styles.hint}>{t('client.ssh.savedConnections')}</Text>
        <View style={styles.actions}>
          {panel.tabs.length > 0 && <SshButton label={t('client.projectBrowser.terminal')} onPress={panel.toggle} />}
          <SshButton label={t('client.ssh.refresh')} disabled={saved.loading} onPress={() => void saved.refresh()} />
        </View>
      </View>
      {!!saved.error && <Text accessibilityRole="alert" style={styles.error}>{displayError(saved.error)}</Text>}
      {saved.profiles.map(item => <View key={item.id} style={styles.row}>
        <Pressable accessibilityRole="button"
        disabled={saved.loading || !!saved.error} onPress={() => choose(item)}
        style={({ pressed }) => [styles.connection, pressed && styles.pressed]}>
        <Ionicons name="terminal-outline" size={24} color={color('#07b775', 'accent')} />
        <View style={styles.labels}><Text style={styles.name}>{item.name || sshLabel(item)}</Text>
          {!!item.name && <Text style={styles.hint}>{sshLabel(item)}</Text>}</View>
        <Ionicons name="chevron-forward" size={20} color={color('#777', 'muted')} />
        </Pressable>
        <Pressable accessibilityRole="button"
          accessibilityLabel={t('client.ssh.editConnection', { name: item.name || sshLabel(item) })}
          disabled={saved.loading || !!saved.error} onPress={() => edit(item)}
          style={({ pressed }) => [styles.edit, pressed && styles.pressed]}>
          <Ionicons name="create-outline" size={22} color={color('#777', 'muted')} />
        </Pressable>
      </View>)}
      {!saved.loading && !saved.error && !saved.profiles.length && <View style={styles.empty}>
        <Text style={styles.name}>{t('client.ssh.noSavedConnections')}</Text>
        <Text style={styles.hint}>{t('client.ssh.emptyConnectionsHint')}</Text>
      </View>}
    </ScrollView>
    <ChatTerminal client={client} cwd="" active connected hideTrigger panel={panel} sshOnly />
    {editor && <SshConnectionSheet settingsOnly api={client.ssh} initial={editor.profile} cwd=""
      connected={panel.adopt} dispose={client.close} close={closeEditor} />}
    {profile && <SshQuickConnectSheet key={profile.id} api={client.ssh} profile={profile} cwd=""
      connected={panel.adopt} dispose={client.close} close={close} />}
  </View>;
}

const useStyles = createThemedStyles(color => ({
  page: { flex: 1, backgroundColor: color('#ededed', 'canvas') },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingVertical: 6 },
  headerSide: { flex: 1, minWidth: 0 },
  headerRight: { alignItems: 'flex-end' },
  title: { ...textMetrics(18, 28), fontWeight: '600', textAlign: 'center', color: color('#181818', 'ink') },
  create: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 16, minHeight: 48 },
  createLabel: { ...textMetrics(16, 24), flexShrink: 1, color: color('#07b775', 'accent') },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: 12,
    backgroundColor: color('#fff', 'surface') },
  connection: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, paddingRight: 4 },
  edit: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  labels: { flex: 1, gap: 4 },
  name: { ...textMetrics(17, 26), color: color('#181818', 'ink'), fontWeight: '500' },
  hint: { ...textMetrics(14, 22), flexShrink: 1, color: color('#777', 'muted') },
  error: { ...textMetrics(14, 22), color: color('#d9534f', 'danger') },
  empty: { paddingVertical: 32, gap: 8, alignItems: 'center' },
  pressed: { opacity: 0.65 },
}));
