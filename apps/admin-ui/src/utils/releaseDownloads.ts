import { findAndroidReleaseAsset } from "../../../../shared/app-update/androidRelease";

const LATEST_RELEASE_API = "https://api.github.com/repos/piperhex/remoteai/releases/latest";

interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

interface GitHubRelease {
  assets?: GitHubReleaseAsset[];
}

export async function getLatestAndroidApkUrl() {
  const response = await fetch(LATEST_RELEASE_API, {
    headers: { Accept: "application/vnd.github+json" },
  });

  if (!response.ok) {
    throw new Error(`GitHub release request failed with status ${response.status}`);
  }

  const release = await response.json() as GitHubRelease;
  const apk = findAndroidReleaseAsset(release.assets);

  if (!apk?.browser_download_url) {
    throw new Error("The latest GitHub release does not contain an APK");
  }

  return apk.browser_download_url;
}
