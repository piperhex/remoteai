import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DOWNLOADS_START = "<!-- codex-switch-downloads:start -->";
const DOWNLOADS_END = "<!-- codex-switch-downloads:end -->";
const LEGACY_INTRO = "Windows, macOS, Linux, Android, and iOS build artifacts are attached below.";
const DESKTOP_INTRO = "Windows, macOS, and Linux build artifacts are attached below.";
const UPDATE_HEADING = "## 更新内容";

const DOWNLOAD_SECTIONS = [
  {
    heading: "### Windows",
    items: [
      downloadItem("x64（Intel / AMD，常用）", [
        asset("EXE 安装包（推荐）", suffix("_windows-x64-setup.exe")),
        asset("MSI 安装包", suffix("_windows-x64.msi")),
      ]),
      downloadItem("ARM64", [
        asset("EXE 安装包（推荐）", suffix("_windows-arm64-setup.exe")),
        asset("MSI 安装包", suffix("_windows-arm64.msi")),
      ]),
    ],
  },
  {
    heading: "### macOS",
    items: [
      downloadItem("Apple 芯片（M 系列）", [
        asset("DMG 安装包", suffix("_macos-aarch64.dmg")),
      ]),
      downloadItem("Intel 芯片", [
        asset("DMG 安装包", suffix("_macos-x64.dmg")),
      ]),
    ],
  },
  {
    heading: "### Linux",
    items: [
      downloadItem("Debian / Ubuntu（x64）", [
        asset("DEB 安装包", suffix("_linux-amd64.deb")),
      ]),
      downloadItem("其他发行版（x64）", [
        asset("AppImage", suffix("_linux-amd64.AppImage")),
      ]),
    ],
  },
  {
    id: "mobile",
    heading: "### 移动端",
    items: [
      downloadItem("Android", [
        asset("APK 安装包", (name) => name.includes("-android-") && name.endsWith(".apk")),
      ]),
      downloadItem("iOS（未签名，仅供构建验证）", [
        asset("APP 压缩包", suffix("-ios-unsigned.app.zip")),
      ]),
    ],
  },
];

function suffix(expectedSuffix) {
  return (name) => name.endsWith(expectedSuffix);
}

function asset(label, matches) {
  return { label, matches };
}

function downloadItem(label, assets) {
  return { label, assets };
}

export function createReleaseBody(release) {
  const downloadBlock = renderDownloadBlock(release.assets ?? [], release.tag_name);
  const releaseNotes = extractReleaseNotes(release.body ?? "");
  const notes = releaseNotes || "本版本暂无其他更新说明。";
  return `${downloadBlock}\n\n${UPDATE_HEADING}\n\n${notes}`;
}

function renderDownloadBlock(assets, tagName) {
  const sections = DOWNLOAD_SECTIONS.map((section) => {
    if (section.id === "mobile" && !section.items.some(item =>
      item.assets.some(definition => assets.some(asset => definition.matches(asset.name))))) {
      return `${section.heading}\n\n- [Android / iOS](https://github.com/piperhex/remoteai-native/releases/latest)`;
    }
    const items = section.items.map((item) => renderDownloadItem(item, assets, tagName));
    return `${section.heading}\n\n${items.join("\n")}`;
  });
  const guidance = [
    "> 请根据设备的系统和处理器选择安装包。一般用户无需下载 `.sig`、`.tar.gz` 或 `latest.json` 文件，",
    "> 这些文件仅供应用自动更新使用。",
  ].join("\n");
  return [
    DOWNLOADS_START,
    "## 下载地址",
    "",
    ...interleaveBlankLines(sections),
    "",
    guidance,
    DOWNLOADS_END,
  ].join("\n");
}

function renderDownloadItem(item, releaseAssets, tagName) {
  const links = item.assets.map((definition) => {
    const releaseAsset = findUniqueAsset(releaseAssets, definition);
    return `[${definition.label}](${versionedAssetUrl(releaseAsset, tagName)})`;
  });
  return `- ${item.label}：${links.join(" ｜ ")}`;
}

function versionedAssetUrl(releaseAsset, tagName) {
  const marker = "/releases/download/";
  const tagStart = releaseAsset.browser_download_url.indexOf(marker) + marker.length;
  const assetStart = releaseAsset.browser_download_url.indexOf("/", tagStart);
  if (!tagName || tagStart < marker.length || assetStart === -1) {
    throw new Error(`${releaseAsset.name} does not have a versionable download URL.`);
  }
  return `${releaseAsset.browser_download_url.slice(0, tagStart)}${tagName}`
    + releaseAsset.browser_download_url.slice(assetStart);
}

function findUniqueAsset(releaseAssets, definition) {
  const matches = releaseAssets.filter((releaseAsset) => (
    releaseAsset.state === "uploaded" && definition.matches(releaseAsset.name)
  ));
  if (matches.length !== 1) {
    throw new Error(`Expected one uploaded ${definition.label}, found ${matches.length}.`);
  }
  if (!matches[0].browser_download_url) {
    throw new Error(`${matches[0].name} does not have a browser download URL.`);
  }
  return matches[0];
}

function interleaveBlankLines(values) {
  return values.flatMap((value, index) => (index === 0 ? [value] : ["", value]));
}

function extractReleaseNotes(body) {
  let notes = removeManagedDownloads(body).trim();
  notes = removeLeadingSection(notes, UPDATE_HEADING);
  notes = removeLeadingSection(notes, LEGACY_INTRO);
  notes = removeLeadingSection(notes, DESKTOP_INTRO);
  return notes.trim();
}

function removeManagedDownloads(body) {
  const start = body.indexOf(DOWNLOADS_START);
  const end = body.indexOf(DOWNLOADS_END);
  if (start === -1 && end === -1) return body;
  if (start === -1 || end < start) {
    throw new Error("The existing release body contains an incomplete downloads section.");
  }
  return `${body.slice(0, start)}${body.slice(end + DOWNLOADS_END.length)}`;
}

function removeLeadingSection(value, prefix) {
  if (value === prefix) return "";
  if (value.startsWith(`${prefix}\n`)) return value.slice(prefix.length).trimStart();
  return value;
}

async function main() {
  const token = requiredEnvironmentVariable("GITHUB_TOKEN");
  const repository = requiredEnvironmentVariable("GITHUB_REPOSITORY");
  const releaseId = requiredEnvironmentVariable("RELEASE_ID");
  const tagName = requiredEnvironmentVariable("TAG_NAME");
  const apiUrl = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
  const releaseUrl = `${apiUrl}/repos/${repository}/releases/${releaseId}`;
  const release = await requestJson(releaseUrl, token);
  if (release.tag_name !== tagName) {
    throw new Error(`Release ${releaseId} uses tag ${release.tag_name}, expected ${tagName}.`);
  }
  const body = createReleaseBody(release);
  await requestJson(releaseUrl, token, {
    method: "PATCH",
    body: JSON.stringify({ body }),
  });
  console.log(`Organized release downloads for ${tagName}.`);
}

function requiredEnvironmentVariable(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function requestJson(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "codex-switch-release",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`GitHub request failed with HTTP ${response.status}: ${body}`);
  }
  return response.json();
}

const isMainModule = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  main().catch((error) => {
    console.error(`Release download organization failed: ${error.message}`);
    process.exitCode = 1;
  });
}
