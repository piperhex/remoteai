import { displayError } from '../i18n/index';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { ActivityIndicator, Keyboard, Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { GuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { useRemoteTerminalLauncher } from '../../../../shared/remote-chat/useRemoteTerminalLauncher';
import { TerminalTabs } from './terminal/TerminalTabs';
import { TerminalSession } from './terminal/TerminalSession';
import { useTerminalStyles as useStyles } from './terminal/styles';
import { BottomSheet } from '../components/BottomSheet';
import { palette } from './styles';
import { useToolLaunch } from '../../../../shared/remote-chat/useToolLaunch';

interface Props {
  client: GuiToolsClient['terminal']; cwd: string; active: boolean; connected: boolean; deviceName?: string;
  launchId?: number; hideTrigger?: boolean;
  sshOnly?: boolean;
}
export type ChatTerminalPanel = ReturnType<typeof useRemoteTerminalLauncher>;

/** Project views may disappear; shells stay on their PC until the user explicitly closes them. */
export function ChatTerminal(props: Props & { panel?: ChatTerminalPanel }) {
  return props.panel ? <TerminalView {...props} panel={props.panel} /> : <StandaloneTerminal {...props} />;
}

function StandaloneTerminal(props: Props) {
  const panel = useRemoteTerminalLauncher(props);
  return <TerminalView {...props} panel={panel} />;
}

function TerminalView({ client, cwd, active, connected, deviceName, launchId = 0, hideTrigger = false, panel, sshOnly }:
  Props & { panel: ChatTerminalPanel }) {
  const resolveThemeColor = useThemeColor();
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  useToolLaunch(launchId, panel.toggle, connected && !panel.busy);
  const selected = panel.tabs.find(tab => tab.id === panel.selected);
  const disabled = panel.busy || (!connected && !panel.tabs.length && !panel.error);
  const hide = () => { Keyboard.dismiss(); panel.hide(); };
  const show = () => { Keyboard.dismiss(); panel.toggle(); };
  return <>
    {!hideTrigger && <Pressable accessibilityRole="button" accessibilityLabel={t("client.chat.openRemoteTerminal")}
      accessibilityState={{ disabled, expanded: active && panel.open }} disabled={disabled}
      style={[styles.button, disabled && styles.disabled]} onPress={show}>
      <Ionicons name="terminal-outline" size={24} color={panel.error ? resolveThemeColor(palette.danger, 'danger') : resolveThemeColor(palette.ink, 'ink')} />
    </Pressable>}
    {!selected && <BottomSheet visible={active && panel.open} title={t("client.chat.remoteTerminal")} subtitle={deviceName}
      onClose={hide} maxWidth={400} actions={[{ label: panel.error ? t("client.terminal.retry") : t("client.chat.newTerminal"),
        onPress: panel.retry, disabled: !connected, loading: panel.busy }]}>
      <TerminalTabs panel={panel} client={client} cwd={cwd} connected={connected} active={active && !!panel.open}
        sshOnly={sshOnly} />
      {panel.busy ? <ActivityIndicator color={color(palette.green, 'accent')} />
        : !!panel.error && <Text accessibilityRole="alert" style={styles.status}>{displayError(panel.error)}</Text>}
    </BottomSheet>}
    {selected && <TerminalSession client={client} session={selected.session} deviceName={deviceName}
      visible={active && panel.open} hide={hide} notice={panel.error}
      tabs={<TerminalTabs key={cwd} panel={panel} client={client} cwd={cwd} connected={connected}
        active={active && !!panel.open} sshOnly={sshOnly} />} />}
  </>;
}
