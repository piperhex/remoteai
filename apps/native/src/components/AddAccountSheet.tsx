import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Modal } from './Modal';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  completeEmbeddedAccountOAuth,
  importPersonalAccounts,
  pollEmbeddedAccountOAuth,
  startEmbeddedAccountOAuth,
} from '../api/client';
import type {
  AccountOAuthPoll,
  AuthSession,
  EmbeddedAccountOAuthCallback,
  EmbeddedAccountOAuthStart,
} from '../types';
import { parseEmbeddedOAuthCallback } from '../utils/embeddedOAuth';
import { Toast } from './AppToast';

const COMPLETION_POLL_ATTEMPTS = 10;
const COMPLETION_POLL_DELAY_MS = 600;

type AddMode = 'choice' | 'oauth' | 'import';

function messageOf(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/expired|not found/i.test(message)) return t("client.mobile.authorizationExpiredReopenTheSignInWindow");
  if (/state is invalid/i.test(message)) return t("client.mobile.securityCheckFailedAuthorizeAgain");
  if (/cancel/i.test(message)) return t("client.mobile.youCancelledChatgptAuthorization");
  if (/reach|connect|network|HTTP 5\d\d/i.test(message)) return t("client.mobile.couldNotConnectCheckYourNetworkAndTryAgain");
  return message || t("client.mobile.couldNotAddTheAccountTryAgainLater");
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForCompletion(session: AuthSession, sessionId: string) {
  for (let attempt = 0; attempt < COMPLETION_POLL_ATTEMPTS; attempt += 1) {
    await delay(COMPLETION_POLL_DELAY_MS);
    const result = await pollEmbeddedAccountOAuth(session, sessionId);
    if (result.status !== 'pending') return result;
  }
  return { status: 'failed', message: t("client.mobile.authorizationTimedOutTryAgain") } as const;
}

function LoadingState({ message }: { message: string }) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  return <View style={styles.centered}><ActivityIndicator color={color("#18af8c", 'accent')} size="large" /><Text style={styles.stateText}>{message}</Text></View>;
}

function ErrorState({ message, onRetry, onClose }: { message: string; onRetry: () => void; onClose: () => void }) {
  const styles = useStyles();
  useLanguage();
  return <View style={styles.centered}>
    <View style={styles.errorIcon}><Text style={styles.errorIconText}>!</Text></View>
    <Text style={styles.errorTitle}>{t("client.mobile.couldNotCompleteAuthorization")}</Text><Text style={styles.errorText}>{message}</Text>
    <View style={styles.errorActions}>
      <Pressable onPress={onClose} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t("client.projectBrowser.close")}</Text></Pressable>
      <Pressable onPress={onRetry} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{t("client.mobile.authorizeAgain")}</Text></Pressable>
    </View>
  </View>;
}

function ImportPanel({ busy, initialContent, onBack, onSubmit, onFile, onClipboard }: {
  busy: boolean;
  initialContent: string;
  onBack: () => void;
  onSubmit: (content: string) => void;
  onFile: () => void;
  onClipboard: () => void;
}) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const [content, setContent] = useState(initialContent);
  useEffect(() => { setContent(initialContent); }, [initialContent]);
  return <View style={styles.importPanel}>
    <Text style={styles.importTitle}>{t("client.mobile.importAccountJson")}</Text>
    <Text style={styles.importHint}>{t("client.mobile.useAuthJsonACompatibleExportOrPasteTheContents")}</Text>
    <TextInput value={content} onChangeText={setContent} multiline textAlignVertical="top" autoCapitalize="none"
      placeholder={t("client.mobile.pasteAccountJsonHere")} placeholderTextColor={color("#91a198", 'muted')} style={styles.importInput} />
    <View style={styles.importActions}>
      <Pressable disabled={busy} onPress={onFile} style={styles.importAction}><Text style={styles.importActionText}>{t("client.cliImport.chooseFile")}</Text></Pressable>
      <Pressable disabled={busy} onPress={onClipboard} style={styles.importAction}><Text style={styles.importActionText}>{t("client.mobile.readClipboard")}</Text></Pressable>
    </View>
    <View style={styles.errorActions}>
      <Pressable onPress={onBack} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t("client.mobile.back")}</Text></Pressable>
      <Pressable disabled={busy || !content.trim()} onPress={() => onSubmit(content)} style={[styles.primaryButton, (!content.trim() || busy) && styles.disabled]}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{t("client.mobile.startImport")}</Text>}
      </Pressable>
    </View>
  </View>;
}

export function AddAccountSheet({ session, visible, onAdded, onClose }: {
  session: AuthSession;
  visible: boolean;
  onAdded: () => Promise<void>;
  onClose: () => void;
}) {
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const [mode, setMode] = useState<AddMode>('choice');
  const [initialImport, setInitialImport] = useState('');
  const [oauth, setOauth] = useState<EmbeddedAccountOAuthStart | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [pageLoading, setPageLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const completingRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      completingRef.current = false;
      setMode('choice'); setInitialImport(''); setOauth(null); setError(''); setPageLoading(false); setBusy(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || mode !== 'oauth') return undefined;
    let cancelled = false;
    setOauth(null); setError(''); completingRef.current = false;
    void startEmbeddedAccountOAuth(session).then((result) => {
      if (!cancelled) { setOauth(result); setPageLoading(true); }
    }).catch((cause) => { if (!cancelled) setError(messageOf(cause)); });
    return () => { cancelled = true; };
  }, [attempt, mode, session, visible]);

  const close = useCallback(() => {
    completingRef.current = false; setMode('choice'); setOauth(null); setError(''); setBusy(false); onClose();
  }, [onClose]);

  const finishAuthorization = useCallback(async (activeOauth: EmbeddedAccountOAuthStart, callback: EmbeddedAccountOAuthCallback) => {
    try {
      let result: AccountOAuthPoll = await completeEmbeddedAccountOAuth(session, activeOauth.sessionId, callback);
      if (result.status === 'pending') result = await waitForCompletion(session, activeOauth.sessionId);
      if (result.status !== 'complete') throw new Error(result.message);
      Toast.success(t("client.mobile.accountAdded")); close(); await onAdded();
    } catch (cause) { completingRef.current = false; setBusy(false); setError(messageOf(cause)); }
  }, [close, onAdded, session]);

  const handleNavigation = useCallback((url: string) => {
    if (!oauth || completingRef.current) return true;
    const callback = parseEmbeddedOAuthCallback(url, oauth.callbackUrl);
    if (!callback) return true;
    completingRef.current = true; setBusy(true); void finishAuthorization(oauth, callback); return false;
  }, [finishAuthorization, oauth]);

  const submitImport = async (content: string) => {
    setBusy(true);
    try {
      const result = await importPersonalAccounts(session, content);
      Toast.success(result.skippedCount ? t("client.mobile.importedSkipped", { value1: result.importedCount, value2: result.skippedCount }) : t("client.mobile.importedAccounts", { value1: result.importedCount }));
      close(); await onAdded();
    } catch (cause) { Toast.fail(messageOf(cause)); }
    finally { setBusy(false); }
  };

  const readClipboard = async () => {
    try { const content = await Clipboard.getStringAsync(); if (!content.trim()) throw new Error(t("client.mobile.noJsonInTheClipboard")); setInitialImport(content); setMode('import'); }
    catch (cause) { Toast.fail(messageOf(cause)); }
  };

  const chooseFile = async () => {
    if (Platform.OS !== 'android') { Toast.fail(t("client.mobile.onIphoneCopyTheJsonAndTapReadClipboard")); return; }
    try {
      const uri = await ReactNativeBlobUtil.android.getContentIntent('application/json');
      if (!uri) return;
      const content = await ReactNativeBlobUtil.fs.readFile(uri, 'utf8');
      await submitImport(content);
    } catch (cause) { Toast.fail(messageOf(cause)); }
  };

  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}
    supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}>
    <SafeAreaView style={styles.root}>
      <View style={styles.header}><View style={styles.heading}><Text style={styles.title}>{t("client.accounts.addAccount")}</Text><Text style={styles.subtitle}>{mode === 'import' ? t("client.mobile.importExistingAccountCredentials") : t("client.mobile.chooseASecureWayToAddAnAccount")}</Text></View><Pressable disabled={busy} onPress={close} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable></View>
      <View style={styles.browser}>
        {mode === 'choice' ? <View style={styles.choicePanel}>
          <Pressable onPress={() => setMode('oauth')} style={styles.choice}><Text style={styles.choiceIcon}>◎</Text><View><Text style={styles.choiceTitle}>{t("client.app.chatgptAuthorization")}</Text><Text style={styles.choiceHint}>{t("client.mobile.signInUsingTheSecureWindow")}</Text></View></Pressable>
          <Pressable onPress={() => void chooseFile()} style={styles.choice}><Text style={styles.choiceIcon}>⌘</Text><View><Text style={styles.choiceTitle}>{t("client.app.importJsonFile")}</Text><Text style={styles.choiceHint}>{t("client.app.supportsAuthJsonAndCompatibleExports")}</Text></View></Pressable>
          <Pressable onPress={() => void readClipboard()} style={styles.choice}><Text style={styles.choiceIcon}>▣</Text><View><Text style={styles.choiceTitle}>{t("client.app.importFromClipboard")}</Text><Text style={styles.choiceHint}>{t("client.mobile.pasteAccountJsonDirectly")}</Text></View></Pressable>
        </View> : mode === 'import' ? <ImportPanel busy={busy} initialContent={initialImport} onBack={() => setMode('choice')} onSubmit={(content) => void submitImport(content)} onFile={() => void chooseFile()} onClipboard={() => void readClipboard()} />
          : error ? <ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} onClose={close} /> : oauth ? <><WebView source={{ uri: oauth.authorizationUrl }} incognito cacheEnabled={false} sharedCookiesEnabled={false} thirdPartyCookiesEnabled saveFormDataDisabled setSupportMultipleWindows={false} javaScriptEnabled domStorageEnabled onLoadStart={() => setPageLoading(true)} onLoadEnd={() => setPageLoading(false)} onShouldStartLoadWithRequest={(request) => handleNavigation(request.url)} onNavigationStateChange={(navigation) => { handleNavigation(navigation.url); }} onError={() => { if (!completingRef.current) setError(t("client.mobile.couldNotLoadSignInCheckYourNetworkAndTry")); }} style={styles.webView} />{pageLoading && !busy ? <View style={styles.loadingOverlay}><ActivityIndicator color={color("#18af8c", 'accent')} /></View> : null}{busy ? <View style={styles.completingOverlay}><LoadingState message={t("client.mobile.savingAccountSecurely")} /></View> : null}</> : <LoadingState message={t("client.mobile.openingSecureChatgptSignIn")} />}
      </View>
    </SafeAreaView>
  </Modal>;
}

const useStyles = createThemedStyles((color) => ({
  root: { flex: 1, backgroundColor: color('#f7faf8', 'canvas') },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color('#dce6e0', 'border'), backgroundColor: color('#fff', 'surface') },
  heading: { flex: 1, minWidth: 0, maxWidth: 400 },
  title: { color: color('#10251d', 'ink'), fontSize: 19, lineHeight: 25, fontWeight: '800' },
  subtitle: { color: color('#708078', 'muted'), fontSize: 12, lineHeight: 18, marginTop: 4 },
  closeButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: color('#eef3f0', 'canvas'), alignItems: 'center', justifyContent: 'center' },
  closeText: { color: color('#52645b', 'ink'), fontSize: 25, lineHeight: 28, marginTop: -2 },
  browser: { flex: 1, backgroundColor: color('#fff', 'surface') },
  webView: { flex: 1, backgroundColor: color('#fff', 'surface') },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  stateText: { color: color('#62756b', 'muted'), fontSize: 13, marginTop: 14, textAlign: 'center' },
  choicePanel: { padding: 20, gap: 12 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 72, padding: 15, borderWidth: 1, borderColor: color('#dce8df', 'border'), borderRadius: 15, backgroundColor: color('#fff', 'surface') },
  choiceIcon: { width: 40, height: 40, borderRadius: 12, color: color('#0b8065', 'accent'), backgroundColor: color('#e6f8f1', 'canvas'), textAlign: 'center', textAlignVertical: 'center', fontSize: 25, fontWeight: '800' },
  choiceTitle: { color: color('#173128', 'ink'), fontSize: 15, fontWeight: '800' },
  choiceHint: { color: color('#708078', 'muted'), fontSize: 11, marginTop: 4 },
  importPanel: { padding: 20 },
  importTitle: { color: color('#13231c', 'ink'), fontSize: 18, fontWeight: '800' },
  importHint: { color: color('#708078', 'muted'), fontSize: 12, lineHeight: 18, marginTop: 6, marginBottom: 12 },
  importInput: { minHeight: 220, borderWidth: 1, borderColor: color('#cbdcd0', 'border'), borderRadius: 12, padding: 12, color: color('#13231c', 'ink'), fontSize: 12, backgroundColor: color('#fbfdfb', 'surface') },
  importActions: { flexDirection: 'row', gap: 9, marginTop: 10 },
  importAction: { flex: 1, minHeight: 42, borderRadius: 10, backgroundColor: color('#e8f8f1', 'canvas'), alignItems: 'center', justifyContent: 'center' },
  importActionText: { color: color('#0b8065', 'accent'), fontSize: 12, fontWeight: '800' },
  errorIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: color('#fff0ef', 'canvas'), alignItems: 'center', justifyContent: 'center' },
  errorIconText: { color: color('#bd3c35', 'danger'), fontSize: 25, fontWeight: '900' },
  errorTitle: { color: color('#8d302b', 'danger'), fontSize: 17, fontWeight: '800', marginTop: 16 },
  errorText: { color: color('#6f8177', 'muted'), fontSize: 13, lineHeight: 20, marginTop: 7, textAlign: 'center', maxWidth: 400 },
  errorActions: { flexDirection: 'row', gap: 10, marginTop: 22, width: '100%', maxWidth: 360 },
  secondaryButton: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: color('#edf2ef', 'elevated'), alignItems: 'center', justifyContent: 'center' },
  primaryButton: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: '#0b8065', alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: color('#173128', 'ink'), fontSize: 14, fontWeight: '800' },
  primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: color('rgba(255,255,255,.84)', 'surface') },
  completingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: color('rgba(255,255,255,.96)', 'surface') },
  disabled: { opacity: 0.5 },
}));
