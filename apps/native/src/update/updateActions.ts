import { t } from '../i18n';
import { Linking, Platform } from 'react-native';
import { Toast } from '../components/AppToast';
import { startAndroidUpdateDownload, type AppRelease } from './appUpdate';

export function openReleasePage(url: string) {
  void Linking.openURL(url).catch(() => Toast.fail(t("无法打开页面，请稍后重试")));
}

export function beginAppUpdateDownload(release: AppRelease) {
  if (Platform.OS !== 'android' || !release.androidAsset) {
    openReleasePage(release.releaseUrl);
    return;
  }
  Toast.success(t("正在下载更新，可继续使用。"));
  void startAndroidUpdateDownload(release).catch(() => Toast.fail(t("下载失败，请稍后重试")));
}
