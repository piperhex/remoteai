import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { GuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { MAX_REMOTE_TERMINALS } from '../../../../shared/remote-chat/useRemoteTerminalPanel';
import { useRemoteTerminalLauncher } from '../../../../shared/remote-chat/useRemoteTerminalLauncher';
import { TerminalSession } from './terminal/TerminalSession';
import { useTerminalStyles as useStyles } from './terminal/styles';
import { BottomSheet } from '../components/BottomSheet';
import { palette } from './styles';
import { useToolLaunch } from '../../../../shared/remote-chat/useToolLaunch';

/** Project views may disappear; shells stay on their PC until the user explicitly closes them. */
export function ChatTerminal({ client, cwd, active, connected, deviceName, launchId = 0, hideTrigger = false }: {
  client: GuiToolsClient['terminal']; cwd: string; active: boolean; connected: boolean; deviceName?: string;
  launchId?: number; hideTrigger?: boolean;
}) {
  const resolveThemeColor = useThemeColor();
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const panel = useRemoteTerminalLauncher({ client, cwd, connected });
  useToolLaunch(launchId, panel.toggle, connected && !panel.busy);
  const selected = panel.tabs.find(tab => tab.id === panel.selected);
  const disabled = panel.busy || (!connected && !panel.tabs.length && !panel.error);
  const hide = () => { Keyboard.dismiss(); panel.hide(); };
  const show = () => { Keyboard.dismiss(); panel.toggle(); };
  return <>
    {!hideTrigger && <Pressable accessibilityRole="button" accessibilityLabel={t("打开远程终端")}
      accessibilityState={{ disabled, expanded: active && panel.open }} disabled={disabled}
      style={[styles.button, disabled && styles.disabled]} onPress={show}>
      <Ionicons name="terminal-outline" size={24} color={panel.error ? resolveThemeColor(palette.danger, 'danger') : resolveThemeColor(palette.ink, 'ink')} />
    </Pressable>}
    {!selected && <BottomSheet visible={active && panel.open} title={t("远程终端")} subtitle={deviceName}
      onClose={hide} maxWidth={400} actions={[{ label: panel.error ? t("重试") : t("新建终端"),
        onPress: panel.retry, disabled: !connected, loading: panel.busy }]}>
      {panel.busy ? <ActivityIndicator color={color(palette.green, 'accent')} />
        : !!panel.error && <Text accessibilityRole="alert" style={styles.status}>{panel.error}</Text>}
    </BottomSheet>}
    {selected && <TerminalSession key={selected.id} client={client} session={selected.session} deviceName={deviceName}
      visible={active && panel.open} hide={hide} close={() => panel.remove(selected.id)} notice={panel.error}
      tabs={<ScrollView horizontal style={styles.tabs} contentContainerStyle={styles.tabItems}>
        {panel.tabs.map((tab, index) => <Pressable key={tab.id} accessibilityRole="tab"
          accessibilityLabel={t("终端 {value1}", { value1: index + 1 })} accessibilityState={{ selected: tab.id === panel.selected }}
          style={[styles.tab, tab.id === panel.selected && styles.selected]} onPress={() => panel.select(tab.id)}>
          <Text style={styles.tabLabel}>{t("终端")}{' '}{index + 1}</Text></Pressable>)}
        <Pressable accessibilityRole="button" accessibilityLabel={t("新建终端")} style={styles.button}
          disabled={panel.busy || !connected || panel.tabs.length >= MAX_REMOTE_TERMINALS} onPress={panel.add}>
          <Ionicons name="add-outline" size={22} color={color("#17211b", 'ink')} /></Pressable>
      </ScrollView>} />}
  </>;
}
