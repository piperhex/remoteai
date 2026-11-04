import assert from "node:assert/strict";
import test from "node:test";

import { createReleaseBody } from "./organize-release-downloads.mjs";

const INSTALLERS = [
  "Codex.Switch_1.2.3_windows-x64-setup.exe",
  "Codex.Switch_1.2.3_windows-x64.msi",
  "Codex.Switch_1.2.3_windows-arm64-setup.exe",
  "Codex.Switch_1.2.3_windows-arm64.msi",
  "Codex.Switch_1.2.3_macos-aarch64.dmg",
  "Codex.Switch_1.2.3_macos-x64.dmg",
  "Codex.Switch_1.2.3_linux-amd64.deb",
  "Codex.Switch_1.2.3_linux-amd64.AppImage",
  "RemoteAI-android-v1.2.3.apk",
  "RemoteAI-ios-unsigned.app.zip",
];

function fixture(body = "Release notes") {
  const assets = INSTALLERS.map((name, index) => ({
    id: index + 1,
    name,
    state: "uploaded",
    browser_download_url: `https://github.test/org/repo/releases/download/untagged-draft/${name}`,
  }));
  assets.push({
    id: 99,
    name: "Codex.Switch_1.2.3_windows-x64-setup.exe.sig",
    state: "uploaded",
    browser_download_url: "https://github.test/org/repo/releases/download/untagged-draft/updater-signature",
  });
  return { body, assets, tag_name: "v1.2.3" };
}

test("groups installable release assets by platform and architecture", () => {
  const body = createReleaseBody(fixture());

  assert.match(body, /## 下载地址/);
  assert.match(body, /### Windows/);
  assert.match(body, /x64（Intel \/ AMD，常用）/);
  assert.match(body, /EXE 安装包（推荐）/);
  assert.match(body, /### macOS/);
  assert.match(body, /Apple 芯片（M 系列）/);
  assert.match(body, /### Linux/);
  assert.match(body, /Debian \/ Ubuntu（x64）/);
  assert.match(body, /### 移动端/);
  assert.match(body, /iOS（未签名，仅供构建验证）/);
  assert.doesNotMatch(body, /updater-signature/);
  assert.doesNotMatch(body, /untagged-draft/);
  assert.match(body, /\/releases\/download\/v1\.2\.3\//);
  assert.match(body, /## 更新内容\n\nRelease notes$/);
  assert.match(body, /\/RemoteAI-android-v1\.2\.3\.apk\)/);
  assert.match(body, /\/RemoteAI-ios-unsigned\.app\.zip\)/);
});

test("keeps download links compatible with legacy mobile release names", () => {
  const release = fixture();
  for (const asset of release.assets) {
    asset.name = asset.name.replace("RemoteAI-", "CodexSwitch-");
    asset.browser_download_url = asset.browser_download_url.replace("RemoteAI-", "CodexSwitch-");
  }
  const body = createReleaseBody(release);
  assert.match(body, /\/CodexSwitch-android-v1\.2\.3\.apk\)/);
  assert.match(body, /\/CodexSwitch-ios-unsigned\.app\.zip\)/);
});

test("desktop releases link to the independent native repository without requiring mobile artifacts", () => {
  const release = fixture();
  release.assets = release.assets.filter(asset => !asset.name.startsWith("RemoteAI-"));
  const body = createReleaseBody(release);
  assert.match(body, /https:\/\/github.com\/piperhex\/remoteai-native\/releases\/latest/);
  assert.match(body, /_windows-x64-setup.exe/);
  assert.doesNotMatch(body, /\/RemoteAI-android-/);
});

test("replaces its generated section without duplicating release notes", () => {
  const firstBody = createReleaseBody(fixture("Original notes"));
  const secondBody = createReleaseBody(fixture(firstBody));

  assert.equal(secondBody, firstBody);
  assert.equal(secondBody.match(/## 下载地址/g)?.length, 1);
  assert.equal(secondBody.match(/## 更新内容/g)?.length, 1);
});

test("removes the legacy artifact message and keeps generated notes", () => {
  const legacyBody = [
    "Windows, macOS, Linux, Android, and iOS build artifacts are attached below.",
    "",
    "**Full Changelog**: https://github.test/compare/v1.2.2...v1.2.3",
  ].join("\n");
  const body = createReleaseBody(fixture(legacyBody));

  assert.doesNotMatch(body, /build artifacts are attached below/);
  assert.match(body, /\*\*Full Changelog\*\*/);
});

test("refuses to publish download links when a required installer is missing", () => {
  const release = fixture();
  release.assets = release.assets.filter((asset) => !asset.name.endsWith("_macos-x64.dmg"));

  assert.throws(() => createReleaseBody(release), /Expected one uploaded DMG 安装包, found 0/);
});
