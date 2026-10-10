import { useThemeColor } from '../../theme/store';
import { t, useLanguage } from '../../i18n';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import type { GuiToolsClient } from '../../../../../shared/remote-chat/guiTools';
import type { TerminalInfo } from '../../../../../shared/terminal/types';
import { remoteTerminalApi } from '../../../../../shared/remote-chat/terminalApi';
import { createTerminalBridge, parseTerminalMessage } from '../../../../../shared/terminal/webviewBridge';
import { terminalDocument } from './terminalDocument';
import { useTerminalOrientation } from './useTerminalOrientation';
import { TerminalKeys } from './TerminalKeys';
import { useTerminalStyles as useStyles } from './styles';

export function TerminalSession({ client, session, visible, deviceName, hide, close, tabs, notice }: {
  client: GuiToolsClient['terminal']; session: TerminalInfo; visible: boolean; deviceName?: string;
  hide: () => void; close: () => void;
  tabs?: ReactNode; notice?: string;
}) {
  const resolveThemeColor = useThemeColor();
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const cwd = session.cwd;
  const webview = useRef<WebView>(null);
  const [html, setHtml] = useState('');
  const [status, setStatus] = useState(t("正在打开终端…"));
  const [generation, setGeneration] = useState(0);
  const [wrap, setWrap] = useState(true);
  const orientation = useTerminalOrientation(visible);
  const source = useMemo(() => ({ html }), [html]);
  const updateDisplay = () => {
    const display = { type: 'display', wrap, shortcuts: !orientation.landscape };
    webview.current?.injectJavaScript(`window.remoteTerminal?.(${JSON.stringify(display)}); true;`);
  };
  const inputKey = (data: string) => {
    webview.current?.injectJavaScript(`window.remoteTerminal?.(${JSON.stringify({ type: 'key', data })}); true;`);
  };
  const bridge = useMemo(() => createTerminalBridge({ cwd, session, api: remoteTerminalApi(client), status: setStatus,
    emit: event => webview.current?.injectJavaScript(`window.remoteTerminal(${JSON.stringify(event)}); true;`),
  }), [client, cwd, session]);
  useEffect(() => () => bridge.dispose(), [bridge]);
  useEffect(() => {
    if (!visible) bridge.detach();
    else setGeneration(value => value + 1);
  }, [visible, bridge]);
  useEffect(() => {
    let cancelled = false;
    void terminalDocument().then(value => { if (!cancelled) setHtml(value); })
      .catch(() => { if (!cancelled) setStatus(t("终端未能加载，请关闭后重新打开。")); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { if (visible) updateDisplay(); }, [wrap, visible, orientation.landscape]);
  const message = notice || status || orientation.error;
  // A translucent navigation bar disables Android's modal resize when the keyboard opens.
  // Let Android resize the WebView; iOS needs explicit keyboard avoidance.
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={hide}
    statusBarTranslucent
    supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}>
    <SafeAreaProvider><KeyboardAvoidingView style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <SafeAreaView style={[styles.overlay, orientation.landscape && styles.fullscreenOverlay]}
      edges={orientation.landscape ? ['top', 'right', 'bottom', 'left'] : ['bottom']}>
      {!orientation.landscape && <Pressable accessibilityRole="button" accessibilityLabel={t("收起终端")}
        style={styles.backdrop} onPress={hide} />}
      <View style={[styles.drawer, orientation.landscape && styles.fullscreen]} accessibilityViewIsModal>
        <View style={[styles.header, orientation.landscape && styles.compactHeader]}>
          {!orientation.landscape && <View style={styles.heading}><Text style={styles.title}>{t("远程终端")}</Text>
            <Text numberOfLines={1} style={styles.subtitle}>{deviceName}{cwd ? ` · ${cwd}` : ''}</Text></View>}
          {orientation.landscape && <View style={styles.inlineTabs}>{tabs}</View>}
          {orientation.landscape && <TerminalKeys input={inputKey} />}
          <Pressable accessibilityRole="switch" accessibilityLabel={t("自动换行")} accessibilityState={{ checked: wrap }}
            style={[styles.wrapButton, wrap && styles.selected]} onPress={() => setWrap(value => !value)}>
            <Ionicons name="return-down-back-outline" size={20} color={wrap ? resolveThemeColor('#14806f', 'accent') : resolveThemeColor('#718078', 'muted')} />
            <Text style={styles.wrapLabel}>{t("自动换行")}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={orientation.landscape ? t("切换竖屏") : t("切换横屏")}
            accessibilityState={{ disabled: orientation.rotating }} disabled={orientation.rotating}
            style={[styles.button, orientation.rotating && styles.disabled]} onPress={orientation.rotate}>
            <Ionicons name={orientation.landscape ? 'phone-portrait-outline' : 'phone-landscape-outline'}
              size={22} color={color("#17211b", 'ink')} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t("关闭终端")} style={styles.button} onPress={close}>
            <Ionicons name="trash-outline" size={21} color={color("#718078", 'muted')} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t("收起终端")} style={styles.button} onPress={hide}>
            <Ionicons name="chevron-down" size={24} color={color("#17211b", 'ink')} /></Pressable>
        </View>
        {!orientation.landscape && tabs}
        {html ? <WebView key={generation} ref={webview} source={source} style={styles.screen}
          originWhitelist={['about:blank']} javaScriptEnabled scrollEnabled={false} bounces={false}
          showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
          allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
          sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false} setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false} keyboardDisplayRequiresUserAction={false}
          onShouldStartLoadWithRequest={({ url }) => url === 'about:blank'}
          onMessage={({ nativeEvent }) => {
            if (!visible) return;
            if (parseTerminalMessage(nativeEvent.data)?.type === 'ready') updateDisplay();
            bridge.receive(nativeEvent.data);
          }}
          onError={() => setStatus(t("终端显示遇到问题，请收起后重新打开。"))} />
          : <ActivityIndicator style={styles.loading} color={color("#14806f", 'accent')} />}
        {!!message && <Text accessibilityRole="alert" style={styles.status}>{message}</Text>}
      </View>
    </SafeAreaView></KeyboardAvoidingView></SafeAreaProvider>
  </Modal>;
}
