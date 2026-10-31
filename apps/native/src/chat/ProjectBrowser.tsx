import { messageKeys } from '../../../../shared/project-browser/messageKeys';
import { displayText, displayError } from '../i18n/index';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { Modal } from '../components/Modal';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import { readAsStringAsync } from 'expo-file-system';
import type { ProjectBrowserClient } from '../../../../shared/project-browser/protocol';
import { handleBrowserRequest, type BrowserHostMessage,
  type BrowserSettings } from '../../../../shared/project-browser/nativeBridge';
import type { BrowserHost } from '../../../../shared/project-browser/entryActions';
import { isNativeSshBrowserAction,
  type NativeSshBrowserAction } from '../../../../shared/terminal/nativeSshBrowserAction';

import { t, useLanguage } from '../i18n';
import { useThemeColor, useThemeMode } from '../theme/store';
import { useWebviewSource } from '../theme/useWebviewSource';
import { createThemedStyles } from '../theme/styles';
import { textMetrics } from '../theme/text';
import { useFilePreferences, setFileAutoSave } from '../settings/filePreferences';
import { readBrowserSession, saveBrowserSession } from './projectBrowserSessions';
import type { DocumentsSnapshot } from '../../../../shared/project-browser/documents';
import { projectBrowserHost } from './projectBrowserHost';
import type { ScriptPanel } from '../../../../shared/terminal/TerminalWorkspaceProvider';
import { handleNativeScriptAction, nativeScriptState } from '../../../../shared/project-browser/nativeScripts';
import { useChatFileReference, useChatFileSelection } from '../../../../shared/chat/ChatFileReferences';

export function ProjectBrowser({ client, cwd, connected, active, onClose, title, subtitle,
  host: suppliedHost, ssh, children, scripts }: {
  client: ProjectBrowserClient; cwd: string; connected: boolean; active: boolean; onClose: () => void;
  title?: string; subtitle?: string; host?: BrowserHost; children?: ReactNode;
  scripts?: ScriptPanel;
  ssh?: { settings: NonNullable<BrowserSettings['ssh']>; onAction: (action: NativeSshBrowserAction) => void };
}) {
  const language = useLanguage();
  const color = useThemeColor();
  const styles = useStyles();
  const preferences = useFilePreferences();
  const webview = useRef<WebView>(null);
  const reference = useChatFileReference();
  const quoteSelection = useChatFileSelection();
  const focusAfterClose = useRef<(() => void) | null>(null);
  const transfer = useMemo(() => new AbortController(), [client, cwd]);
  const host = useMemo(() => suppliedHost ?? ({ ...projectBrowserHost(client, transfer.signal),
    reference: async (entry: Parameters<typeof reference>[0]) => { focusAfterClose.current = reference(entry); },
    quoteSelection: async (selection: Parameters<typeof quoteSelection>[0]) => {
      focusAfterClose.current = quoteSelection(selection);
    },
  }), [client, transfer, reference, quoteSelection, suppliedHost]);
  useEffect(() => () => transfer.abort(), [transfer]);
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [generation, setGeneration] = useState(0);
  const currentGeneration = useRef(generation);
  const recover = () => { setReady(false); setFullscreen(false); setGeneration(++currentGeneration.current); };
  const mode = useThemeMode();
  const source = useWebviewSource(html, { mode, background: color('#fff', 'surface'),
    foreground: color('#202c29', 'ink'), variables: { '--panel': color('#fff', 'surface') } });
  const emit = (message: BrowserHostMessage) => {
    // Request IDs restart with the renderer; a late reply must not resolve a new request with the same ID.
    if (generation !== currentGeneration.current) return;
    webview.current?.injectJavaScript(`window.projectBrowserMessage?.(${JSON.stringify(message)}); true;`);
  };
  const close = () => { if (ready) emit({ type: 'close' }); else onClose(); };
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const asset = Asset.fromModule(require('../../assets/project-browser.html'));
      await asset.downloadAsync();
      if (!asset.localUri) throw new Error('Missing browser asset');
      const content = await readAsStringAsync(asset.localUri);
      if (!cancelled) setHtml(content);
    };
    void load().catch(() => {
      if (!cancelled) setError('client.projectBrowser.theFileBrowserCouldNotLoadPleaseReopenIt');
    });
    return () => { cancelled = true; };
  }, []);
  const update = () => emit({ type: 'settings', language, cwd, themeMode: mode,
    connected: connected && active && preferences.ready,
    autoSaveDelay: preferences.delay, snapshot: readBrowserSession(client, cwd),
    scripts: scripts && !ssh ? nativeScriptState(scripts) : undefined,
    ssh: ssh?.settings, capabilities: { entryActions: host.entryActions, downloadDirectory: host.downloadDirectory,
      reference: !!host.reference, quoteSelection: !!host.quoteSelection, blame: !!client.blame },
    labels: Object.fromEntries(messageKeys.map(text => [text, displayText(text)])),
    theme: { '--ink': color('#202c29', 'ink'), '--muted': color('#718078', 'muted'),
      '--panel': color('#fff', 'surface'), '--bg': color('#f5f8f6', 'canvas'),
      '--line': color('#dfe5e1', 'border'), '--green': color('#138475', 'accent'),
      '--browser-on-accent': color('#fff', 'canvas') } });
  useEffect(() => { if (ready) update(); },
    [ready, connected, active, cwd, language, color, mode, preferences, host, ssh, scripts]);
  // Backgrounding the app must not unmount the WebView and discard its unsaved document.
  return <Modal visible={active} animationType="slide" onRequestClose={close}
    supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}>
    <SafeAreaProvider><SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.header, fullscreen && styles.hidden]}>
          <Ionicons name="folder-open-outline" size={21} color={color('#202c29', 'ink')} />
          <View style={styles.heading}>
            <Text style={styles.title}>{title ?? t("client.projectBrowser.browseFiles")}</Text>
            <Text style={styles.subtitle}>{subtitle ?? cwd.split(/[\\/]/).filter(Boolean).at(-1)}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("client.projectBrowser.closeFileBrowser")}
            style={styles.close} onPress={close}><Ionicons name="close" size={24} color={color('#202c29', 'ink')} /></Pressable>
        </View>
        {!html && !error && <ActivityIndicator style={styles.fill} color={color('#138475', 'accent')} />}
        {html && <WebView key={generation} ref={webview} source={source} style={styles.screen} javaScriptEnabled
          onContentProcessDidTerminate={recover} onRenderProcessGone={recover}
          scrollEnabled={false} bounces={false} originWhitelist={['about:blank']}
          allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
          sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false} setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false} keyboardDisplayRequiresUserAction
          onShouldStartLoadWithRequest={({ url }) => url === 'about:blank'}
          onMessage={({ nativeEvent }) => {
            if (generation !== currentGeneration.current) return;
            let message: unknown;
            try { message = JSON.parse(nativeEvent.data); } catch { return; }
            if (!message || typeof message !== 'object' || !('type' in message)) return;
            try {
              if (handleNativeScriptAction(message, { panel: ssh ? undefined : scripts, cwd,
                connected: connected && active })) { setError(''); return; }
            } catch (error) { setError(displayError(error)); return; }
            if (isNativeSshBrowserAction(message)) { ssh?.onAction(message); return; }
            if (message.type === 'ready') { setReady(true); update(); return; }
            if (message.type === 'fullscreen' && 'active' in message && typeof message.active === 'boolean') {
              setFullscreen(message.active); return;
            }
            if (message.type === 'snapshot' || message.type === 'closed') {
              if (message.type === 'snapshot' && (!('cwd' in message) || message.cwd !== cwd)) return;
              if ('snapshot' in message && message.snapshot && typeof message.snapshot === 'object'
                && 'tabs' in message.snapshot && Array.isArray(message.snapshot.tabs)) {
                saveBrowserSession(client, cwd, message.snapshot as DocumentsSnapshot);
              }
              if (message.type === 'snapshot') return;
              onClose();
              if (focusAfterClose.current) requestAnimationFrame(focusAfterClose.current);
              return;
            }
            if (message.type === 'preferences' && 'delay' in message && typeof message.delay === 'number') {
              void setFileAutoSave(message.delay).then(saved => {
                if (!saved) setError('未能保存设置，请重试。');
              });
              return;
            }
            void handleBrowserRequest(nativeEvent.data, { client, cwd, host, connected: connected && active })
              .then(reply => { if (reply) emit(reply); });
          }}
          onError={() => {
            setReady(false); setFullscreen(false); setError('client.projectBrowser.theFileBrowserCouldNotLoadPleaseReopenIt');
          }} />}
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{displayError(error)}</Text>}
        {children}
      </KeyboardAvoidingView>
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}

const useStyles = createThemedStyles(color => ({
  screen: { flex: 1, backgroundColor: color('#fff', 'surface') },
  fill: { flex: 1 },
  hidden: { display: 'none' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, minHeight: 60,
    borderBottomWidth: 1, borderBottomColor: color('#dfe5e1', 'border') },
  heading: { flex: 1, minWidth: 0 },
  title: { ...textMetrics(16, 24), fontWeight: '600', color: color('#202c29', 'ink') },
  subtitle: { ...textMetrics(12, 18), color: color('#718078', 'muted') },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  error: { ...textMetrics(14, 22), color: color('#c44545', 'danger'), padding: 16, maxWidth: 400 },
}));
