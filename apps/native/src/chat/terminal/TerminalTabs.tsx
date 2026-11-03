import { useEffect, useState } from 'react';
import { Keyboard, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { GuiToolsClient } from '../../../../../shared/remote-chat/guiTools';
import type { useRemoteTerminalLauncher } from '../../../../../shared/remote-chat/useRemoteTerminalLauncher';
import { MAX_REMOTE_TERMINALS } from '../../../../../shared/remote-chat/useRemoteTerminalPanel';
import { sshLabel } from '../../../../../shared/terminal/sshProfiles';
import { t, useLanguage } from '../../i18n';
import { useThemeColor } from '../../theme/store';
import { useTerminalStyles } from './styles';
import { SshConnectionMenu } from './SshConnectionMenu';
import { SshFilesSheet } from './SshFilesSheet';
import { TerminalTabItem } from './TerminalTabItem';
import { useTabOverflow } from './useTabOverflow';
import { BottomSheet } from '../../components/BottomSheet';
import { SheetGestureScrollView } from '../../components/SheetScrollGesture';
import type { TerminalInfo } from '../../../../../shared/terminal/types';

function terminalLabel(session: TerminalInfo, index: number) {
  if (session.ssh) return sshLabel(session.ssh);
  if (session.npmScript) return `npm run ${session.npmScript}`;
  return t('client.mobile.terminal', { value1: index + 1 });
}

export function TerminalTabs({ panel, client, cwd, connected, active, sshOnly }: {
  panel: ReturnType<typeof useRemoteTerminalLauncher>; client: GuiToolsClient['terminal'];
  cwd: string; connected: boolean; active: boolean;
  sshOnly?: boolean;
}) {
  useLanguage();
  const styles = useTerminalStyles();
  const color = useThemeColor();
  const [tool, setTool] = useState<'ssh' | 'files'>();
  const [more, setMore] = useState(false);
  const overflow = useTabOverflow(panel.tabs.map(tab => tab.id), panel.selected);
  const hidden = panel.tabs.filter(tab => overflow.hiddenIds.includes(tab.id));
  useEffect(() => { if (!active || !hidden.length) setMore(false); }, [active, hidden.length]);
  useEffect(() => { if (!active) setTool(value => value === 'files' ? value : undefined); }, [active]);
  useEffect(() => { setTool(undefined); }, [client, cwd]);
  const selected = panel.tabs.find(tab => tab.id === panel.selected);
  const disabled = panel.busy || !connected || panel.tabs.length >= MAX_REMOTE_TERMINALS;
  return <View>
    <View style={styles.tabsRow}>
      <View style={styles.tabs} onLayout={event => overflow.setBarWidth(event.nativeEvent.layout.width)}>
      <ScrollView ref={overflow.viewport} horizontal style={styles.tabViewport} contentContainerStyle={styles.tabItems}
        showsHorizontalScrollIndicator={false} onLayout={event => overflow.setViewportWidth(event.nativeEvent.layout.width)}
        onContentSizeChange={overflow.setContentWidth} scrollEventThrottle={16}
        onScroll={event => overflow.setScrollLeft(event.nativeEvent.contentOffset.x)}>
        {panel.tabs.map((tab, index) => {
          const label = terminalLabel(tab.session, index);
          return <TerminalTabItem key={tab.id} label={label} index={index} selected={tab.id === panel.selected}
            maxWidth={overflow.viewportWidth || 220} onLayout={event => overflow.layout(tab.id, event)}
            choose={() => panel.select(tab.id)} close={() => panel.remove(tab.id)} />;
        })}
      </ScrollView>
      {overflow.overflowing && <Pressable accessibilityRole="button" accessibilityLabel={t('client.terminal.moreTabs')}
        accessibilityState={{ expanded: more }} style={styles.button}
        onPress={() => { Keyboard.dismiss(); setMore(true); }}>
        <Ionicons name="ellipsis-horizontal" size={20} color={color('#17211b', 'ink')} />
      </Pressable>}
      </View>
      <Pressable accessibilityRole="button"
        accessibilityLabel={t(sshOnly ? 'client.ssh.new' : 'client.chat.newTerminal')}
        style={[styles.button, disabled && styles.disabled]} disabled={disabled}
        onPress={sshOnly ? () => { Keyboard.dismiss(); setTool('ssh'); } : panel.add}>
        <Ionicons name="add-outline" size={22} color={color('#17211b', 'ink')} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('client.ssh.menu')}
        accessibilityState={{ expanded: tool === 'ssh' && active }}
        style={[styles.button, disabled && styles.disabled]} disabled={disabled}
        onPress={() => { Keyboard.dismiss(); setTool('ssh'); }}>
        <Ionicons name="chevron-down" size={21} color={color('#17211b', 'ink')} />
      </Pressable>
      {selected?.session.ssh && <Pressable accessibilityRole="button" accessibilityLabel={t('client.ssh.files')}
        style={styles.button} onPress={() => { Keyboard.dismiss(); setTool('files'); }}>
        <Ionicons name="folder-open-outline" size={22} color={color('#17211b', 'ink')} />
      </Pressable>}
    </View>
    {more && active && <BottomSheet visible title={t('client.terminal.moreTabs')} maxWidth={400}
      onClose={() => setMore(false)}>
      <SheetGestureScrollView>{hidden.map(tab => <TerminalTabItem key={tab.id} menu
        label={terminalLabel(tab.session, panel.tabs.indexOf(tab))}
        index={panel.tabs.indexOf(tab)} selected={tab.id === panel.selected}
        choose={() => { panel.select(tab.id); setMore(false); }}
        close={() => panel.remove(tab.id)} />)}</SheetGestureScrollView>
    </BottomSheet>}
    {tool === 'ssh' && active && <SshConnectionMenu api={client.ssh} cwd={cwd} connected={panel.adopt}
      dispose={client.close} close={() => setTool(undefined)} />}
    {tool === 'files' && selected?.session.ssh && <SshFilesSheet key={selected.id} api={client.ssh}
      info={selected.session} connected={connected} active={active} close={() => setTool(undefined)} />}
  </View>;
}
