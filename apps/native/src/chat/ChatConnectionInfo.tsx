import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { RemoteDevice } from '../types';
import type { ChatState } from './types';
import type { ChatController } from '../../../../shared/remote-chat/client/controller';
import { ChatProjectPicker } from './ChatProjectPicker';
import { ChatReconnectButton } from './ChatReconnectButton';
import { HOST_IDENTITY_CHANGED } from '../../../../shared/remote-chat/trustedHost';
import { HostIdentityVerification } from './HostIdentityVerification';
import { ChatConnectionHealth } from './ChatConnectionHealth';
import { useStyles } from './styles';

const modeLabels = { get connecting() { return t("正在连接…"); }, direct: 'P2P', relay: 'Relay', get offline() { return t("等待重新连接"); } };

export function ChatConnectionInfo({ state, controller, device, active }: {
  state: ChatState; controller: ChatController; device?: RemoteDevice; active: boolean;
}) {
  const connectionStyles = useConnectionStyles();
  const styles = useStyles();
  useLanguage();
  const [picking, setPicking] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const canChoose = active && state.ready && !state.selected && !state.sending;
  const canReconnect = active && device && !state.ready && !state.connecting && state.mode !== 'connecting';
  let status = modeLabels[state.mode];
  if (!state.ready && (state.mode === 'direct' || state.mode === 'relay')) status = t("正在同步聊天…");
  if (!state.ready && state.error && !state.connecting) status = t("连接未完成");
  useEffect(() => { if (!canChoose) setPicking(false); }, [canChoose]);
  return <>
    <View style={connectionStyles.row}>
      <Text numberOfLines={1} style={[styles.headerMeta, connectionStyles.device,
        canReconnect && connectionStyles.reconnectingDevice]}>
        {device ? device.name : t("选择电脑，开始聊天")}</Text>
      {device && <>
        <Text style={styles.headerMeta}> · </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`${status} · ${t('连接体检')}`}
          accessibilityState={{ expanded: healthOpen }} hitSlop={{ top: 6, bottom: 6 }}
          onPress={() => setHealthOpen(true)}>
          <Text style={styles.headerMeta}>{status}</Text>
        </Pressable>
      </>}
      {canReconnect && <>
        <Text style={styles.headerMeta}> · </Text>
        <ChatReconnectButton retryAt={state.retryAt} onPress={controller.connectNow} />
      </>}
      {state.error === HOST_IDENTITY_CHANGED && <Pressable onPress={() => setVerifying(true)} accessibilityRole="button">
        <Text>{t("核对电脑身份")}</Text></Pressable>}
      {!state.selected && !canReconnect && <>
        <Text style={styles.headerMeta}> · </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("选择项目")} disabled={!canChoose}
          style={connectionStyles.project} onPress={() => setPicking(true)}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.headerMeta}>
            {state.draftProject?.label || t("未选择项目")}</Text>
        </Pressable>
      </>}
    </View>
    {healthOpen && <ChatConnectionHealth state={state} device={device}
      reconnect={controller.connectNow} close={() => setHealthOpen(false)} />}
    {picking && canChoose && <ChatProjectPicker cwd={state.draftProject?.cwd}
      load={controller.loadProjectDirectories} close={() => setPicking(false)}
      choose={(project) => { controller.chooseDraftProject(project); setPicking(false); }} />}
    {verifying && <HostIdentityVerification confirm={controller.confirmHostIdentity} close={() => setVerifying(false)} />}
  </>;
}

const useConnectionStyles = createThemedStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  device: { flexShrink: 1 },
  reconnectingDevice: { maxWidth: '40%' },
  project: { flexShrink: 1, minWidth: 0, maxWidth: '60%' },
}));
