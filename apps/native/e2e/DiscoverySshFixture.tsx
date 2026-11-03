import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { useMemo, useState } from 'react';
import { Button, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import type { GuiToolsClient } from '../../../shared/remote-chat/guiTools';
import type { TerminalEvent, TerminalInfo } from '../../../shared/terminal/types';
import { setInterfaceLanguage } from '../../../shared/localization/interfaceLanguage';
import { DiscoveryPage } from '../src/discovery/DiscoveryPage';
import { SshPage } from '../src/discovery/SshPage';
import { BottomNavigation } from '../src/discovery/BottomNavigation';
import { PrimaryPagePager } from '../src/navigation/PrimaryPagePager';
import { updateThemeMode, useThemeColor } from '../src/theme/store';
import { createSshFixture } from './sshFixture';

setInterfaceLanguage('zh');
function createClient(mode: string): GuiToolsClient['terminal'] {
  const sessions = new Map<string, { info: TerminalInfo; events: TerminalEvent[] }>();
  const ssh = createSshFixture('Discovery', info => sessions.set(info.id, { info,
    events: [{ type: 'output', data: [...new TextEncoder().encode('SSH ready\r\n$ ')] }] }));
  const list = ssh.profiles.list;
  const save = ssh.profiles.save;
  let rejected = false;
  ssh.profiles.save = async (profile, credentials) => {
    if (profile.name === 'New-server' && !rejected) {
      rejected = true; throw new Error('client.ssh.storageFailed');
    }
    return save(profile, credentials);
  };
  ssh.profiles.list = async () => {
    if (mode === 'error') throw new Error('client.ssh.loadFailed');
    if (mode === 'empty') return [];
    return list();
  };
  return {
    ssh, list: async () => [...sessions.values()].map(value => value.info),
    open: async () => { throw new Error('Discovery must not open a local shell'); },
    link: async () => { throw new Error('Not used by this fixture'); },
    read: async (id, cursor) => ({ found: sessions.has(id), cursor: sessions.get(id)?.events.length ?? 0,
      truncated: false, events: sessions.get(id)?.events.slice(cursor) ?? [] }),
    write: async (id, data) => {
      sessions.get(id)?.events.push({ type: 'output', data: [...new TextEncoder().encode(data)] });
    },
    resize: async () => {}, close: async id => { sessions.delete(id); },
    writeBinary: async () => {}, binaryMode: async () => {},
  };
}

function DiscoverySshFixture() {
  const [fonts] = useFonts(Ionicons.font);
  const [page, setPage] = useState('discover');
  const [mode, setMode] = useState('saved');
  const client = useMemo(() => createClient(mode), [mode]);
  const color = useThemeColor();
  const canvas = { flex: 1, backgroundColor: color('#ededed', 'canvas') };
  return <SafeAreaProvider><SafeAreaView style={canvas} edges={['left', 'right', 'bottom']}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingTop: 30 }}>
      <Button title="Light" onPress={() => updateThemeMode('light')} />
      <Button title="Dark" onPress={() => updateThemeMode('dark')} />
      <Button title="Saved" onPress={() => setMode('saved')} />
      <Button title="Empty" onPress={() => setMode('empty')} />
      <Button title="Error" onPress={() => setMode('error')} />
    </View>
    {fonts && <PrimaryPagePager page={page} onChange={setPage}
      pageStyles={{ chat: canvas, accounts: canvas, discover: canvas, settings: canvas }} pages={{
        chat: null,
        discover: <DiscoveryPage onOpen={setPage} />, accounts: null, settings: null,
      }}>{page === 'ssh' && <SshPage key={mode} client={client} onBack={() => setPage('discover')} />}
      </PrimaryPagePager>}
    <BottomNavigation activePage={page} onChange={setPage} />
  </SafeAreaView></SafeAreaProvider>;
}
registerRootComponent(DiscoverySshFixture);
