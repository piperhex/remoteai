import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Modal } from '../components/Modal';
import { useStartupUpdate } from '../../../../shared/app-update/useStartupUpdate';
import { startupUpdateOptions } from './startupUpdate';
import { beginAppUpdateDownload } from './updateActions';
import { useAndroidUpdateDownloadState } from './useAndroidUpdateDownloadState';

export function StartupUpdatePrompt() {
  const styles = useStyles();
  useLanguage();
  const update = useStartupUpdate(startupUpdateOptions);
  const download = useAndroidUpdateDownloadState();
  const [error, setError] = useState('');
  const release = update.release;
  if (!release || download.status === 'downloading' || download.status === 'downloaded') return null;
  if (download.status === 'cancelled' && download.version === release.version) return null;

  const ignore = () => {
    setError('');
    void update.ignoreVersion().catch(() => setError(t("client.settings.couldNotSavePleaseTryAgain")));
  };
  const install = () => {
    update.dismiss();
    beginAppUpdateDownload(release);
  };

  return <Modal transparent visible animationType="fade" onRequestClose={update.dismiss}
    supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}>
    <View style={styles.backdrop}>
      <View accessibilityViewIsModal style={styles.dialog}>
        <Text accessibilityRole="header" style={styles.title}>{t("client.settings.updateAvailable")}</Text>
        <Text style={styles.message}>Remote AI v{release.version}{' '}{t("client.mobile.isAvailableUpdateNow")}</Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={ignore} style={styles.button}>
            <Text style={styles.ignore}>{t("client.settings.skipThisVersion")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={install} style={[styles.button, styles.primary]}>
            <Text style={styles.install}>{t("client.settings.updateNow")}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  </Modal>;
}

const useStyles = createThemedStyles((color) => ({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.4)' },
  dialog: { width: '100%', maxWidth: 400, padding: 24, borderRadius: 20, backgroundColor: color('#fff', 'surface') },
  title: { fontSize: 20, fontWeight: '700', color: color('#1c3028', 'ink') },
  message: { marginTop: 12, fontSize: 15, lineHeight: 23, color: color('#60746a', 'muted') },
  error: { marginTop: 12, fontSize: 14, color: color('#b74740', 'danger') },
  actions: { marginTop: 24, flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  button: { flexGrow: 1, minHeight: 44, paddingVertical: 12, paddingHorizontal: 8,
    alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: color('#f0f4f2', 'canvas') },
  primary: { backgroundColor: '#079c70' },
  ignore: { fontSize: 15, fontWeight: '600', color: color('#52645b', 'ink') },
  install: { fontSize: 15, fontWeight: '600', color: '#fff' },
}));
