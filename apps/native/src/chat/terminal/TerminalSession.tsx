import { displayError } from '../../i18n/index';
import { useThemeColor, useThemeMode } from '../../theme/store';
import { useWebviewSource } from '../../theme/useWebviewSource';
import { terminalAppearance } from '../../../../../shared/terminal/theme';
import { t, useLanguage } from '../../i18n';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { Modal } from '../../components/Modal';
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
import { useZmodemFiles } from './useZmodemFiles';
import { ZmodemSheet } from './ZmodemSheet';

export function TerminalSession({ client, session, visible, deviceName, hide, tabs, notice }: {
  client: GuiToolsClient['terminal']; session: TerminalInfo; visible: boolean; deviceName?: string;
  hide: () => void;
  tabs?: ReactNode; notice?: string;
}) {
  const resolveThemeColor = useThemeColor();
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const cwd = session.cwd;
  const webview = useRef<WebView>(null);
  const [html, setHtml] = useState('');
  const [status, setStatus] = useState(t("client.chat.openingTerminal"));
  const [generation, setGeneration] = useState(0);
  const [wrap, setWrap] = useState(true);
  const zmodem = useZmodemFiles();
  const orientation = useTerminalOrientation(visible);
  const mode = useThemeMode();
  const appearance = terminalAppearance(mode === 'dark');
  const source = useWebviewSource(html, { mode, background: appearance.theme.background,
    foreground: appearance.theme.foreground, variables: appearance.variables }, generation);
  const updateDisplay = () => {
    const display = { type: 'display', wrap, shortcuts: !orientation.landscape, theme: mode };
    webview.current?.injectJavaScript(`window.remoteTerminal?.(${JSON.stringify(display)}); true;`);
  };
  const inputKey = (data: string) => {
    webview.current?.injectJavaScript(`window.remoteTerminal?.(${JSON.stringify({ type: 'key', data })}); true;`);
  };
  const bridge = useMemo(() => createTerminalBridge({ cwd, session, api: remoteTerminalApi(client), status: setStatus,
    zmodem: zmodem.handlers,
    emit: event => webview.current?.injectJavaScript(`window.remoteTerminal(${JSON.stringify(event)}); true;`),
  }), [client, cwd, session, zmodem.handlers]);
  useEffect(() => () => bridge.dispose(), [bridge]);
  useEffect(() => {
    if (!visible) bridge.detach();
    else setGeneration(value => value + 1);
  }, [visible, bridge]);
  useEffect(() => {
    let cancelled = false;
    void terminalDocument().then(value => { if (!cancelled) setHtml(value); })
      .catch(() => { if (!cancelled) setStatus(t("client.mobile.terminalDidNotLoadCloseAndReopenIt")); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { if (visible) updateDisplay(); }, [wrap, visible, orientation.landscape, mode]);
  const labels = `(() => { const screen = document.getElementById('viewport'); const keys = document.querySelector('nav');
    if (screen) screen.setAttribute('aria-label', ${JSON.stringify(t("client.projectBrowser.terminal"))});
    if (keys) keys.setAttribute('aria-label', ${JSON.stringify(t("client.runtimeErrors.terminalShortcuts"))}); })(); true;`;
  useEffect(() => { webview.current?.injectJavaScript(labels); }, [labels]);
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
      {!orientation.landscape && <Pressable accessibilityRole="button" accessibilityLabel={t("client.chat.hideTerminal")}
        style={styles.backdrop} onPress={hide} />}
      <View style={[styles.drawer, orientation.landscape && styles.fullscreen]} accessibilityViewIsModal>
        <View style={[styles.header, orientation.landscape && styles.compactHeader]}>
          {!orientation.landscape && <View style={styles.heading}><Text style={styles.title}>{t("client.chat.remoteTerminal")}</Text>
            <Text numberOfLines={1} style={styles.subtitle}>{deviceName}{cwd ? ` · ${cwd}` : ''}</Text></View>}
          {orientation.landscape && <View style={styles.inlineTabs}>{tabs}</View>}
          {orientation.landscape && <TerminalKeys input={inputKey} />}
          <Pressable accessibilityRole="switch" accessibilityLabel={t("client.projectBrowser.wrapLines")} accessibilityState={{ checked: wrap }}
            style={[styles.wrapButton, wrap && styles.selected]} onPress={() => setWrap(value => !value)}>
            <Ionicons name="return-down-back-outline" size={20} color={wrap ? resolveThemeColor('#14806f', 'accent') : resolveThemeColor('#718078', 'muted')} />
            <Text style={styles.wrapLabel}>{t("client.projectBrowser.wrapLines")}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={orientation.landscape ? t("client.mobile.switchToPortrait") : t("client.mobile.switchToLandscape")}
            accessibilityState={{ disabled: orientation.rotating }} disabled={orientation.rotating}
            style={[styles.button, orientation.rotating && styles.disabled]} onPress={orientation.rotate}>
            <Ionicons name={orientation.landscape ? 'phone-portrait-outline' : 'phone-landscape-outline'}
              size={22} color={color("#17211b", 'ink')} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t("client.chat.hideTerminal")} style={styles.button} onPress={hide}>
            <Ionicons name="chevron-down" size={24} color={color("#17211b", 'ink')} /></Pressable>
        </View>
        {!orientation.landscape && tabs}
        {html ? <WebView key={generation} ref={webview} source={source}
          style={[styles.screen, { backgroundColor: appearance.theme.background }]}
          originWhitelist={['about:blank']} javaScriptEnabled scrollEnabled={false} bounces={false}
          showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
          allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
          sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false} setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false} keyboardDisplayRequiresUserAction={false}
          onShouldStartLoadWithRequest={({ url }) => url === 'about:blank'}
          onLoadEnd={() => { webview.current?.injectJavaScript(labels); }}
          onMessage={({ nativeEvent }) => {
            if (!visible) return;
            if (parseTerminalMessage(nativeEvent.data)?.type === 'ready') updateDisplay();
            bridge.receive(nativeEvent.data);
          }}
          onError={() => setStatus(t("client.mobile.terminalDisplayFailedCloseAndReopenIt"))} />
          : <ActivityIndicator style={styles.loading} color={color("#14806f", 'accent')} />}
        {!!message && <Text accessibilityRole="alert" style={styles.status}>{displayError(message)}</Text>}
        <ZmodemSheet files={zmodem} transfer={bridge.transfer} visible={visible} />
      </View>
    </SafeAreaView></KeyboardAvoidingView></SafeAreaProvider>
  </Modal>;
}
