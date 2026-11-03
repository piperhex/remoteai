import { displayText } from '../i18n/index';
import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BottomSheet } from '../components/BottomSheet';
import { copyText, saveTextFile } from './copyText';
import { palette, useStyles } from './styles';
import { Toast } from '../components/AppToast';
import { textMetrics } from '../theme/text';

export interface CopyAction { text: string; label: string }
export const INLINE_COPY_WIDTH = 30;
const INLINE_BASELINE_OFFSET = 4;

interface ExportRequest { text: string; reason: 'too-large' | 'failed' }

function useTextCopy(text: string | (() => string)) {
  const [status, setStatus] = useState('');
  const [request, setRequest] = useState<ExportRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; clearTimeout(timer.current);
  }; }, []);
  const notice = (value: string) => {
    if (!mounted.current) return;
    setStatus(value);
    AccessibilityInfo.announceForAccessibility(displayText(value));
    if (value === "client.app.couldNotCopyPleaseTryAgain") Toast.fail(displayText(value));
    else if (value !== "client.chat.copied") Toast.success(displayText(value));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(''), 2000);
  };
  const copy = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const value = typeof text === 'function' ? text() : text;
      const result = await copyText(value);
      if (!mounted.current) return;
      if (result === 'copied') notice("client.chat.copied");
      else if (Platform.OS === 'android') { setError(''); setRequest({ text: value, reason: result }); }
      else notice("client.app.couldNotCopyPleaseTryAgain");
    } finally { busy.current = false; }
  };
  const save = async () => {
    if (!request || busy.current) return;
    busy.current = true; setSaving(true); setError('');
    try {
      const result = await saveTextFile(request.text);
      if (result && mounted.current) {
        setRequest(null);
        notice(result.location === 'downloads' ? t("client.mobile.savedToDownloads") : t("client.mobile.savedToTheSelectedFolder"));
      }
    } catch { if (mounted.current) setError(t("client.mobile.couldNotSaveTryAgain.3461df")); }
    finally { busy.current = false; if (mounted.current) setSaving(false); }
  };
  return { status, request, saving, error, copy, save, close: () => setRequest(null) };
}

export function CopyTextButton({ text, label = t("client.projectBrowser.copied"), variant = 'inline' }: {
  text: string | (() => string); label?: string; variant?: 'inline' | 'labeled' | 'icon';
}) {
  const copyStyles = useCopyStyles();
  const color = useThemeColor();
  const styles = useStyles();
  useLanguage();
  const copy = useTextCopy(text);
  const labeled = variant === 'labeled';
  return <View style={variant === 'inline' && copyStyles.inline}>
    <Pressable accessibilityRole="button" accessibilityLabel={copy.status ? displayText(copy.status) : label}
      style={[variant === 'inline' ? copyStyles.button : copyStyles.actionButton,
        variant === 'icon' && copyStyles.iconButton]} hitSlop={8}
      disabled={copy.saving} onPress={() => void copy.copy()}>
      <Feather name={copy.status === "client.chat.copied" ? 'check' : 'copy'} size={15} color={color(palette.muted, 'muted')} />
      {labeled && <Text style={copyStyles.label}>{copy.status ? displayText(copy.status) : label}</Text>}
    </Pressable>
    {copy.request && <BottomSheet visible title={t("client.mobile.saveFullContent")} onClose={copy.close} dismissible={!copy.saving}
      actions={[{ label: t("client.mobile.saveFullContent"), onPress: copy.save, loading: copy.saving, disabled: copy.saving }]}>
      <Text style={[styles.messageText, { maxWidth: 400 }]}>{copy.request.reason === 'too-large'
        ? t("client.mobile.thisContentIsLongSaveTheFullTextToA") : t("client.mobile.couldNotCopyYouCanSaveTheFullTextTo")}</Text>
      {!!copy.error && <Text accessibilityRole="alert" style={styles.error}>{copy.error}</Text>}
    </BottomSheet>}
  </View>;
}

const useCopyStyles = createThemedStyles((color) => ({
  actionButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 },
  // Keep the touch area below the icon so its height does not add space after the reply.
  iconButton: { width: 32, justifyContent: 'center', alignItems: 'flex-start' },
  label: { color: color(palette.muted, 'muted'), ...textMetrics(14, 20), flexShrink: 1 },
  // Explicit dimensions let Android lay out this view as one inline attachment in a TextView.
  inline: { width: INLINE_COPY_WIDTH, height: 20 },
  // The inline view ends at the text baseline; the icon's visible bottom also needs the font's descent.
  button: { flex: 1, alignItems: 'center', justifyContent: 'center',
    transform: [{ translateY: INLINE_BASELINE_OFFSET }] },
}));
